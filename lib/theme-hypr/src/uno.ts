export const hyprUnoTheme = {
  fontFamily: {
    mono: "var(--hg-font-mono, ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace)",
    sans: "var(--hg-font-body, ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace)",
  },
  colors: {
    'bg-base': 'rgb(var(--hg-bg-base-rgb))',
    'bg-surface': 'rgb(var(--hg-bg-surface-rgb))',
    'bg-elevated': 'rgb(var(--hg-bg-elevated-rgb))',
    'bg-overlay': 'rgb(var(--hg-bg-overlay-rgb))',
    border: {
      DEFAULT: 'rgb(var(--hg-border-default-rgb))',
      default: 'rgb(var(--hg-border-default-rgb))',
      dim: 'rgb(var(--hg-border-dim-rgb))',
    },
    'accent-green': 'rgb(var(--hg-accent-green-rgb))',
    'accent-amber': 'rgb(var(--hg-accent-amber-rgb))',
    'accent-red': 'rgb(var(--hg-accent-red-rgb))',
    'text-primary': 'rgb(var(--hg-text-primary-rgb))',
    'text-secondary': 'rgb(var(--hg-text-secondary-rgb))',
    'text-muted': 'rgb(var(--hg-text-muted-rgb))',
    'text-dim': 'rgb(var(--hg-text-dim-rgb))',
  },
} as const;
