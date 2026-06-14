# Security Policy

## Supported Versions

The latest release on the `main` branch is actively maintained. Security fixes are applied to `main`.

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ |
| older | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public issue.**

Instead, report it privately via [GitHub Security Advisories](https://github.com/nazmussaqibpiash/live-tv/security/advisories/new). Please include:

- A description of the vulnerability and its impact
- Steps to reproduce or a proof of concept
- Any suggested remediation

You can expect an initial response within **72 hours**, and we'll keep you updated as we investigate and patch.

## Scope & Notes

- **No secrets in the repo.** API tokens (Cloudflare, GitHub) must be provided via environment variables / GitHub Secrets. Never commit `.dev.vars`, `.env`, or tokens.
- **Stream URLs are public.** This project only indexes publicly accessible stream links; it does not host content.
- Reports about third-party stream content or upstream IPTV sources are out of scope.

Thank you for helping keep the project and its users safe. 🔒
