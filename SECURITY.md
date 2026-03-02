# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in flow2code, please **do not** report it in a public Issue.

### How to Report

1. **GitHub Security Advisories** (Recommended)  
   Go to [Security Advisories](../../security/advisories/new) to create a private security report.

2. **Email**  
   Send a detailed description to the maintainer's email (see the author field in package.json).

### What to Include

- Description of the vulnerability and its impact
- Steps to reproduce (the more detailed, the better)
- Affected versions
- Possible fixes (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 7 days
- **Fix release**: Depending on severity — critical vulnerabilities will be patched within 14 days

### Security Features

flow2code includes the following built-in security mechanisms:

- **IR Security Validator** (`validateIRSecurity()`) — Scans AI-generated IR for malicious code patterns
- **Dangerous API Detection in Custom Code** — Compile-time warnings for `eval()`, `child_process`, `fs`, and other dangerous calls
- **Content-Security-Policy** — Standalone dev server sets CSP headers
- **Body Size Limit** — API endpoints limit request body to 2MB
- **Input Validation** — IR validator checks structural correctness (version, nodes, edges, cycle detection)

Thank you for helping keep flow2code secure!
