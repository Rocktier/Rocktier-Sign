# Rocktier Sign

**Sign documents on your machine, not someone else's server.**

A buy-once, fully offline desktop digital signature tool. Uses public-key cryptography to make signatures verifiable and unforgeable — your files never leave your device.

## Positioning

> Sign documents on your machine, not someone else's server.

Privacy-first electronic signature tool for people who choose not to upload their documents to the cloud.

## Target Users

- Small business owners, freelancers, independent contractors in English-speaking countries
- Privacy-sensitive professionals: lawyers, accountants, medical practitioners, financial advisors
- Those with compliance needs but limited budget, unwilling to pay DocuSign $10-40/month

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Tauri v2 (Rust) |
| Sign Engine | [digitorus/pdfsign](https://github.com/digitorus/pdfsign) (Go, BSD-2-Clause) |
| Frontend | React 18 + TypeScript + Vite |
| Signature Standard | PAdES (PDF Advanced Electronic Signatures) |
| Self-update | tauri-plugin-updater + GitHub Releases |

## Pricing

| Plan | Price |
|------|-------|
| Rocktier Sign standalone | $9.99 one-time |
| Rocktier Family Bundle (6 apps) | $19.99 one-time |

## Security — where your private key lives

Your signing **private key is never written to disk as a plaintext file.** It is stored in the operating system's secure credential store:

- **macOS** — the Keychain
- **Windows** — the Credential Manager (DPAPI-backed)
- **Linux** — the secret-service / libsecret backend

The public certificate (`.crt`) is kept in the app data folder; the private key is only ever briefly materialised to a throwaway temp file while a signature is being computed, and that temp file is deleted immediately afterwards.

Because the key lives inside the OS secure store, it is bound to your user account: a stolen disk image, a cloud/Time Machine backup, or another process on the same machine cannot read it without your OS login. Use full-disk encryption (FileVault / BitLocker) as an additional layer. If you reset your OS account password without migrating the keychain, the stored key becomes unrecoverable — re-create the certificate in that case.

## Development

```bash
# Install dependencies
npm install

# Run dev mode
npm run tauri:dev

# Build for production (CI only)
# See .github/workflows/build.yml
```

## Project Structure

```
Rocktier Sign/
├── src/                     # React frontend (TypeScript)
├── src-tauri/               # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs          # Entry point
│   │   └── lib.rs           # Menu, sign engine IPC
│   ├── capabilities/        # Tauri permissions
│   └── icons/               # App icons (multi-platform)
├── sign-engine/             # Go signing CLI source
│   └── sign-engine-windows.exe  # Pre-compiled binary
└── package.json
```

## License

Rocktier Sign is proprietary software. The signing engine is based on [digitorus/pdfsign](https://github.com/digitorus/pdfsign) (BSD-2-Clause).
