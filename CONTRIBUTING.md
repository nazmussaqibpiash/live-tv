# Contributing to Live TV

Thanks for your interest in improving **Live TV**! Contributions of all kinds are welcome — bug reports, feature ideas, docs, and code.

## 🚀 Getting Started

```bash
git clone https://github.com/nazmussaqibpiash/live-tv.git
cd live-tv
npm install
npm run dev
```

To work on the self-maintenance pipeline:

```bash
MAX_VALIDATE=200 npm run pipeline:all   # fast local run
```

## 🧭 Development Workflow

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feat/my-improvement
   ```
2. Make your changes, keeping commits focused and atomic.
3. Run the quality gate **before** opening a PR:
   ```bash
   npm run lint
   npm run test
   npm run build
   ```
4. Push your branch and open a Pull Request against `main`.

## ✅ Pull Request Checklist

- [ ] `npm run lint` passes with no new warnings
- [ ] `npm run test` passes
- [ ] `npm run build` succeeds
- [ ] PR description explains **what** changed and **why**
- [ ] Linked to a relevant issue (if one exists)

## 📝 Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(player): add tap-to-unmute affordance
fix(pipeline): drop sources after two reported failures
docs(readme): clarify quick start
chore(ci): bump node version
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`.

## 🐛 Reporting Bugs

Open an [issue](https://github.com/nazmussaqibpiash/live-tv/issues/new?template=bug_report.md) and include:
- Steps to reproduce
- Expected vs actual behavior
- Browser / OS and any console errors

## 💡 Suggesting Features

Open a [feature request](https://github.com/nazmussaqibpiash/live-tv/issues/new?template=feature_request.md) describing the problem you want solved and your proposed approach.

## 📜 Code of Conduct

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

Happy hacking! 📺
