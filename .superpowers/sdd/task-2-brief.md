### Task 2: Configure Tailwind CSS

**Files:**
- Create: `apps/proxy-admin/tailwind.config.js`
- Create: `apps/proxy-admin/postcss.config.js`
- Modify: `apps/proxy-admin/src/styles/global.css`
- Modify: `apps/proxy-admin/vite.config.ts`

**Interfaces:**
- Consumes: Tailwind CSS installed from Task 1
- Produces: Tailwind CSS configured and working in project

- [ ] **Step 1: Initialize Tailwind config**

Run:
```bash
cd /Users/cashely.shi/Documents/projects/cc-monitoring/apps/proxy-admin
npx tailwindcss init -p
```

Expected: Creates `tailwind.config.js` and `postcss.config.js` files.

- [ ] **Step 2: Update tailwind.config.js**

Replace content with:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  corePlugins: {
    preflight: false, // Disable preflight to avoid conflicts with Ant Design
  },
}
```

- [ ] **Step 3: Update src/styles/global.css**

Add Tailwind directives at top:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Rest of existing global styles */
```

- [ ] **Step 4: Verify Tailwind works**

Add a test class to `App.tsx`:
```tsx
function App() {
  return <div className="text-red-500 text-2xl">Hello Tailwind</div>
}
```

Run dev server:
```bash
pnpm dev
```

Expected: Page shows red "Hello Tailwind" text.

- [ ] **Step 5: Revert test change in App.tsx**

- [ ] **Step 6: Commit**
```bash
git add tailwind.config.js postcss.config.js src/styles/global.css
git commit -m "feat: configure Tailwind CSS"
```
