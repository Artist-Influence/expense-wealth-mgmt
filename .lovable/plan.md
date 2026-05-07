## Problem

The Login page calls `navigate('/', { replace: true })` directly in the render body when the user is already authenticated. This triggers a React state update during render, causing an infinite re-render loop and the glitchy loading behavior.

## Fix

Wrap the redirect logic in Login.tsx with a `useEffect` or replace the imperative `navigate()` call with a declarative `<Navigate to="/" replace />` component (same pattern used in AuthGuard). This is a one-file fix in `src/pages/Login.tsx`.

### Technical detail

Replace the current early-return block:

```tsx
if (user && isAuthorized) {
  navigate('/', { replace: true });
  return null;
}
```

With:

```tsx
if (user && isAuthorized) {
  return <Navigate to="/" replace />;
}
```

This avoids the setState-during-render warning and stops the loop.
