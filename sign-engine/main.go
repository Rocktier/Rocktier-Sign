package main

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"time"

	"github.com/digitorus/pdfsign/sign"
	"github.com/digitorus/pdfsign/verify"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}

	switch os.Args[1] {
	case "sign":
		cmdSign()
	case "verify":
		cmdVerify()
	case "generate-key":
		cmdGenerateKey()
	default:
		usage()
	}
}

func usage() {
	fmt.Println("Usage: sign-engine <command> [options]")
	fmt.Println("")
	fmt.Println("Commands:")
	fmt.Println("  sign           Sign a PDF file")
	fmt.Println("  verify         Verify a PDF signature")
	fmt.Println("  generate-key   Generate a self-signed certificate + private key")
	fmt.Println("")
	fmt.Println("  sign -name <name> -input <input.pdf> -output <output.pdf> -key <private.key> -cert <cert.crt> [-image <sig.png>] [-llx <x>] [-lly <y>] [-urx <x>] [-ury <y>]")
	fmt.Println("  verify <input.pdf>")
	fmt.Println("  generate-key -name <name> -key-out <private.key> -cert-out <cert.crt>")
	os.Exit(1)
}

// readPEM reads a PEM-encoded file and returns blocks or raw content
func readPEM(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	return data, nil
}

func loadPrivateKey(path string) (crypto.Signer, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(data)
	if block == nil {
		// Try parsing as raw
		block = &pem.Block{Type: "PRIVATE KEY", Bytes: data}
	}

	// Try PKCS8 first
	keyAny, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err == nil {
		signer, ok := keyAny.(crypto.Signer)
		if ok {
			return signer, nil
		}
	}

	// Try PKCS1 (RSA only)
	rsaKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err == nil {
		return rsaKey, nil
	}

	// Try EC
	ecKey, err := x509.ParseECPrivateKey(block.Bytes)
	if err == nil {
		return ecKey, nil
	}

	return nil, fmt.Errorf("unable to parse private key from %s", path)
}

func loadCertificate(path string) (*x509.Certificate, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found in %s", path)
	}

	return x509.ParseCertificate(block.Bytes)
}

func cmdSign() {
	var name, input, output, keyPath, certPath, imagePath string
	var llx, lly, urx, ury float64
	hasCoords := false

	// Parse flags manually for simplicity
	args := os.Args[2:]
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-name":
			name = args[i+1]; i++
		case "-input":
			input = args[i+1]; i++
		case "-output":
			output = args[i+1]; i++
		case "-key":
			keyPath = args[i+1]; i++
		case "-cert":
			certPath = args[i+1]; i++
		case "-image":
			imagePath = args[i+1]; i++
		case "-llx":
			fmt.Sscanf(args[i+1], "%f", &llx); i++
		case "-lly":
			fmt.Sscanf(args[i+1], "%f", &lly); i++
		case "-urx":
			fmt.Sscanf(args[i+1], "%f", &urx); i++
		case "-ury":
			fmt.Sscanf(args[i+1], "%f", &ury); i++
			hasCoords = true
		}
	}

	if input == "" || output == "" || keyPath == "" || certPath == "" {
		fmt.Fprintln(os.Stderr, "Error: -input, -output, -key, -cert are required")
		usage()
	}

	signer, err := loadPrivateKey(keyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading private key: %v\n", err)
		os.Exit(2)
	}

	cert, err := loadCertificate(certPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading certificate: %v\n", err)
		os.Exit(2)
	}

	signData := sign.SignData{
		Signature: sign.SignDataSignature{
			Info: sign.SignDataSignatureInfo{
				Name: name,
			},
			CertType:   sign.ApprovalSignature,
			DocMDPPerm: sign.AllowFillingExistingFormFieldsAndSignaturesPerms,
		},
		Signer:          signer,
		DigestAlgorithm: crypto.SHA256,
		Certificate:     cert,
	}

	if hasCoords && imagePath != "" {
		// Has image signature appearance
		imageData, err := os.ReadFile(imagePath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading image: %v\n", err)
			os.Exit(2)
		}
		signData.Appearance = sign.Appearance{
			Visible:     true,
			LowerLeftX:  llx,
			LowerLeftY:  lly,
			UpperRightX: urx,
			UpperRightY: ury,
			Image:       imageData,
		}
	} else if hasCoords {
		signData.Appearance = sign.Appearance{
			Visible:     true,
			LowerLeftX:  llx,
			LowerLeftY:  lly,
			UpperRightX: urx,
			UpperRightY: ury,
		}
	}

	err = sign.SignFile(input, output, signData)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error signing: %v\n", err)
		os.Exit(3)
	}

	fmt.Printf("OK: signed %s -> %s\n", input, output)
}

func cmdVerify() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "Error: verify requires a PDF file path")
		usage()
	}

	input := os.Args[2]
	file, err := os.Open(input)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error opening file: %v\n", err)
		os.Exit(2)
	}
	defer file.Close()

	options := verify.DefaultVerifyOptions()
	options.AllowUntrustedRoots = true

	result, err := verify.VerifyFileWithOptions(file, options)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error verifying: %v\n", err)
		os.Exit(3)
	}

	jsonData, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(jsonData))
}

func cmdGenerateKey() {
	var name, keyOut, certOut string
	args := os.Args[2:]
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-name":
			name = args[i+1]; i++
		case "-key-out":
			keyOut = args[i+1]; i++
		case "-cert-out":
			certOut = args[i+1]; i++
		}
	}

	if name == "" || keyOut == "" || certOut == "" {
		fmt.Fprintln(os.Stderr, "Error: -name, -key-out, -cert-out are required")
		usage()
	}

	// Generate P-256 EC key
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error generating key: %v\n", err)
		os.Exit(2)
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName:   name,
			Organization: []string{"Rocktier Sign (Self-Signed)"},
		},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour), // 10 years
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
		BasicConstraintsValid: true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &privateKey.PublicKey, privateKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating certificate: %v\n", err)
		os.Exit(2)
	}

	// Write private key
	keyFile, err := os.Create(keyOut)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating key file: %v\n", err)
		os.Exit(2)
	}
	defer keyFile.Close()

	keyDER, _ := x509.MarshalECPrivateKey(privateKey)
	pem.Encode(keyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	keyFile.Close()

	// Write certificate
	certFile, err := os.Create(certOut)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error creating cert file: %v\n", err)
		os.Exit(2)
	}
	defer certFile.Close()

	pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	certFile.Close()

	fmt.Printf("OK: generated self-signed certificate for %q\n", name)
	keyAbs, _ := filepath.Abs(keyOut)
	certAbs, _ := filepath.Abs(certOut)
	fmt.Printf("  Private key: %s\n", keyAbs)
	fmt.Printf("  Certificate: %s\n", certAbs)
}
