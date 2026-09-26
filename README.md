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
