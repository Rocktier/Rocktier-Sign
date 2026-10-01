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
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math/big"
	"os"
	"path/filepath"
	"time"

	"github.com/digitorus/pdfsign/sign"
	"github.com/digitorus/pdfsign/verify"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
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
	case "generate-sig-image":
		cmdGenerateSigImage()
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
	fmt.Println("  generate-sig-image  Generate a default signature appearance PNG")
	fmt.Println("")
	fmt.Println("  sign -name <name> -input <input.pdf> -output <output.pdf> -key <private.key> -cert <cert.crt> [-image <sig.png>] [-position <top-left|top-right|bottom-left|bottom-right>] [-page <n>]")
	fmt.Println("  verify <input.pdf>")
	fmt.Println("  generate-key -name <name> -key-out <private.key> -cert-out <cert.crt>")
	fmt.Println("  generate-sig-image -name <name> -output <sig.png>")
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
	var name, input, output, keyPath, certPath, imagePath, position string
	var page int

	// Parse flags
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
		case "-position":
			position = args[i+1]; i++
		case "-page":
			fmt.Sscanf(args[i+1], "%d", &page); i++
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

	// Default: bottom-right on the last page if visual sig requested but no position given
	if position == "" {
		position = "bottom-right"
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

	// If image path provided OR position explicitly requested, add visual appearance
	if imagePath != "" {
		imageData, err := os.ReadFile(imagePath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading image: %v\n", err)
			os.Exit(2)
		}
		llx, lly, urx, ury := positionToCoords(position, page, 0, 220.0, 72.0)
		signData.Appearance = sign.Appearance{
			Visible:     true,
			LowerLeftX:  llx,
			LowerLeftY:  lly,
			UpperRightX: urx,
			UpperRightY: ury,
			Image:       imageData,
		}
	}

	err = sign.SignFile(input, output, signData)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error signing: %v\n", err)
		os.Exit(3)
	}

	fmt.Printf("OK: signed %s -> %s\n", input, output)
}

// positionToCoords converts a named position into PDF coordinates.
// PDF origin is bottom-left. A4-ish page assumed (595×842 pt).
// Signature rect defaults to 220×72 pt.
func positionToCoords(pos string, page, customPage int, w, h float64) (llx, lly, urx, ury float64) {
	if w == 0 {
		w = 220
	}
	if h == 0 {
		h = 72
	}
	
	margin := 40.0
	pageWidth := 595.0
	pageHeight := 842.0

	switch pos {
	case "top-left":
		llx = margin
		lly = pageHeight - margin - h
		urx = margin + w
		ury = pageHeight - margin
	case "top-right":
		llx = pageWidth - margin - w
		lly = pageHeight - margin - h
		urx = pageWidth - margin
		ury = pageHeight - margin
	case "bottom-left":
		llx = margin
		lly = margin
		urx = margin + w
		ury = margin + h
	case "bottom-right":
		llx = pageWidth - margin - w
		lly = margin
		urx = pageWidth - margin
		ury = margin + h
	default:
		// Default to bottom-right
		llx = pageWidth - margin - w
		lly = margin
		urx = pageWidth - margin
		ury = margin + h
	}
	return
}

// cmdGenerateSigImage creates a default signature appearance PNG.
func cmdGenerateSigImage() {
	var name, output string
	args := os.Args[2:]
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-name":
			name = args[i+1]; i++
		case "-output":
			output = args[i+1]; i++
		}
	}

	if name == "" || output == "" {
		fmt.Fprintln(os.Stderr, "Error: -name, -output are required")
		usage()
	}

	now := time.Now().Format("2006-01-02 15:04")
	if err := generateSigImage(name, now, output); err != nil {
		fmt.Fprintf(os.Stderr, "Error generating sig image: %v\n", err)
		os.Exit(2)
	}
	fmt.Printf("OK: generated %s\n", output)
}

// generateSigImage draws a clean digital signature appearance.
func generateSigImage(name, dateStr, outputPath string) error {
	const width, height = 220, 72

	// Dark background with rounded-corner feel via border
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	
	// Transparent background
	draw.Draw(img, img.Bounds(), &image.Uniform{color.RGBA{0, 0, 0, 0}}, image.Point{}, draw.Src)
	
	// Fill with subtle dark background
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{255, 255, 255, 255})
		}
	}
	
	// Border
	borderColor := color.RGBA{0, 0, 0, 255}
	for x := 0; x < width; x++ {
		img.Set(x, 0, borderColor)
		img.Set(x, height-1, borderColor)
	}
	for y := 0; y < height; y++ {
		img.Set(0, y, borderColor)
		img.Set(width-1, y, borderColor)
	}
	
	// Inner light border (2px)
	innerColor := color.RGBA{230, 230, 230, 255}
	for x := 2; x < width-2; x++ {
		img.Set(x, 2, innerColor)
		img.Set(x, height-3, innerColor)
	}
	for y := 2; y < height-2; y++ {
		img.Set(2, y, innerColor)
		img.Set(width-3, y, innerColor)
	}

	// Add text: name (bold) + date (smaller)
	face := basicfont.Face7x13
	
	// Name text (centered vertically, slightly above center)
	nameY := height/2 - 8
	addLabel(img, face, 10, nameY, name, color.RGBA{0, 0, 0, 255})
	
	// Date text
	dateY := height/2 + 10
	addLabel(img, face, 10, dateY, "Digitally signed: "+dateStr, color.RGBA{60, 60, 60, 255})
	
	// Right-side: red dot (brand mark)
	redDot := color.RGBA{255, 74, 61, 255}
	for dy := -6; dy <= 6; dy++ {
		for dx := -6; dx <= 6; dx++ {
			if dx*dx+dy*dy <= 36 {
				img.Set(width-22+dx, height/2+dy, redDot)
			}
		}
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer f.Close()

	return png.Encode(f, img)
}

// addLabel draws text on the image at the given coordinates.
func addLabel(img *image.RGBA, face font.Face, x, y int, text string, col color.Color) {
	point := fixed.Point26_6{
		X: fixed.I(x),
		Y: fixed.I(y),
	}
	d := &font.Drawer{
		Dst:  img,
		Src:  image.NewUniform(col),
		Face: face,
		Dot:  point,
	}
	d.DrawString(text)
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
	// Self-signed certs are trusted via the embedded certificate, not via a
	// root exemption — leave the chain check on so a forged chain fails.
	options.AllowUntrustedRoots = false

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

	// Random 128-bit serial: a constant serial (big.NewInt(1)) means every
	// user's certificate shares the same identity number — no PKI semantics.
	serialLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, err := rand.Int(rand.Reader, serialLimit)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error generating serial number: %v\n", err)
		os.Exit(2)
	}

	template := x509.Certificate{
		SerialNumber: serial,
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

	// Write private key. 0600 — a "signatures unforgeable" tool must not
	// leave the signing key group/world-readable (os.Create → 0644).
	keyFile, err := os.OpenFile(keyOut, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
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
