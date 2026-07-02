### Task 1: Install Dependencies

**Files:**
- Modify: `apps/proxy-admin/package.json`
- Modify: `pnpm-lock.yaml` (auto-generated)

**Interfaces:**
- Produces: Required dependencies installed: `vite-plugin-mock`, `tailwindcss`, `postcss`, `autoprefixer`

- [ ] **Step 1: Install dependencies via pnpm**

Run:
```bash
cd /Users/cashely.shi/Documents/projects/cc-monitoring/apps/proxy-admin
pnpm add -D vite-plugin-mock mockjs tailwindcss postcss autoprefixer
pnpm add @ant-design/icons
```

Expected: All dependencies installed successfully, no errors.

- [ ] **Step 2: Verify installation**

Run:
```bash
pnpm list tailwindcss vite-plugin-mock @ant-design/icons
```

Expected: Shows installed versions of all packages.

- [ ] **Step 3: Commit**
```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install tailwindcss, vite-plugin-mock and icons"
```
