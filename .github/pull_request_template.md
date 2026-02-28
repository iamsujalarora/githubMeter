## Summary

<!-- What does this PR change and why? 1–3 sentences. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation

## Testing

<!-- How did you verify this works? -->

- [ ] Tested on Windows
- [ ] Tested on macOS
- [ ] Tested on Linux

## Checklist

- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] Rust compiles (`cargo check` in `src-tauri/`)
- [ ] No new `.unwrap()` panics introduced in Rust
- [ ] No new `localStorage` token storage (tokens go in keyring only)
