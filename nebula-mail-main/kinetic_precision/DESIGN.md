---
name: Kinetic Precision
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#464555'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#6b38d4'
  on-secondary: '#ffffff'
  secondary-container: '#8455ef'
  on-secondary-container: '#fffbff'
  tertiary: '#00505f'
  on-tertiary: '#ffffff'
  tertiary-container: '#006a7c'
  on-tertiary-container: '#93e8ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#acedff'
  tertiary-fixed-dim: '#4cd7f6'
  on-tertiary-fixed: '#001f26'
  on-tertiary-fixed-variant: '#004e5c'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: inter
    fontSize: 2rem
    fontWeight: '600'
    lineHeight: 2.5rem
    letterSpacing: -0.025em
  headline-md:
    fontFamily: inter
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: inter
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: inter
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.5rem
    letterSpacing: -0.005em
  body-md:
    fontFamily: inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: 0em
  body-sm:
    fontFamily: inter
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0em
  label-md:
    fontFamily: inter
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.01em
  code-badge:
    fontFamily: jetbrainsMono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: -0.02em
  shortcut-key:
    fontFamily: jetbrainsMono
    fontSize: 0.625rem
    fontWeight: '600'
    lineHeight: 0.75rem
    letterSpacing: 0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  space-xxs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-base: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  nav-width: 15rem
  list-width-min: 20rem
  list-width-default: 24rem
  copilot-width: 24rem
---

## Brand & Style

This design system embodies the efficiency of keyboard-first execution paired with the ambient intelligence of an integrated autonomous Copilot. Tailored for executives, engineers, operators, and power communicators, the experience removes visual friction to foster hyper-focus and velocity. 

The aesthetic is grounded in **Precision Modernism with Ambient Intelligence**:
- **Structured Architectural Surfaces:** Clean, slate-tinted canvas backdrops with razor-thin structural dividers, avoiding heavy drop shadows or unnecessary decorative textures.
- **Instrumental Density:** Information density remains compact and high-yield, drawing inspiration from professional IDEs and high-velocity workflow clients like Linear and Superhuman.
- **Differentiated AI Agency:** Traditional user interactions utilize disciplined indigo cues, while automated agent behaviors, programmatic function calls, and machine interventions surface via a luminous violet-to-cyan gradient signature.
- **Physical Feedback:** Interface interactions mirror physical instrument panels—immediate keystroke responsiveness, low-latency state changes, and explicit execution confirmations for agentic tool use.

## Colors

The palette establishes an absolute contrast hierarchy between operational email functions and automated agent execution states.

### Core Roles
- **Primary Canvas (`#F8FAFC`):** Base slate workspace background that provides soft, low-glare depth.
- **Layered Surface (`#FFFFFF`):** Pure white container surfaces reserved for read panes, focused threads, elevated modals, and input fields.
- **Primary Brand (`#4F46E5` to `#6366F1`):** Deep to vibrant indigo, driving standard navigation selection, primary action triggers, and active focus boundaries.
- **Copilot Dynamic Accent (`#8B5CF6` / `#06B6D4`):** Violet and cyan pairings. Violet indicates AI cognition and draft suggestions; cyan denotes real-time function execution, workspace introspection, and automated UI state control.
- **Neutral Stack:**
  - `Surface Border Subtle`: `#E2E8F0` (Default panel outlines, row dividers)
  - `Surface Border Strong`: `#CBD5E1` (Active boundaries, focus states)
  - `Text Primary`: `#0F172A` (Headlines, email senders, unread titles)
  - `Text Secondary`: `#475569` (Body previews, metadata labels)
  - `Text Muted`: `#94A3B8` (Timestamps, keyboard shortcuts, disabled items)

### Semantic Application
- **Success (`#10B981`):** Real-time pub/sub sync heartbeat, successful background dispatch, accepted tool actions.
- **Warning (`#F59E0B`):** Human-in-the-loop interventions, unsaved drafts, pending tool authorizations.
- **Danger (`#EF4444`):** Thread purge, batch destructive actions, failed API/sync connections.

## Typography

Typography balances high-legibility scanning with technical precision:
- **Proportional Primary (`Inter`):** Drives all macro reading experiences, thread headers, message bodies, and navigation trees. Font smoothing is enforced via subpixel anti-aliasing. Unread threads utilize weight `600` for clear distinction over read states (`400`).
- **Tabular Monospace (`JetBrains Mono`):** Deployed for function call strings (`⚡ Executed openCompose()`), execution status tags, precise sync latency readouts, and global keyboard command glyphs (`⌘K`, `E`, `J`, `K`).
- **Optical Tracking:** Tighter tracking (`-0.025em`) is applied to top-level subjects and pane headers to convey structural discipline. Label and metadata tiers maintain neutral or slightly positive tracking to prevent eye fatigue across repetitive scanning tasks.

## Layout & Spacing

The architecture operates on an asymmetric multi-pane model optimized for wide-aspect desktop viewports:

### Grid & Pane System
- **Pane 1 (Navigation & System Tree):** Fixed `15rem` width. Houses account switchers, core mailbox filters, labels, and the persistent pub/sub live sync status node. Collapsible to a `4rem` icon bar.
- **Pane 2 (Thread Feed):** Fluid width with a hard minimum of `20rem` and default of `24rem`. Optimized for single-line scanning with dense list rows (`3rem` standard, `2.5rem` compact).
- **Pane 3 (Detail Reading Canvas):** Dynamically expands to absorb available canvas width. Max body column length capped at `48rem` for optimal optical line tracking.
- **Pane 4 (Copilot Drawer):** `24rem` right-docked sliding drawer. Can be docked or unpinned into an ephemeral floating command palette (`⌘K`).

### Spacing Philosophy
- Strict **4px / 8px baseline rhythm**.
- Padding inside interactive email items conforms to `0.75rem` vertical and `1rem` horizontal.
- Borders act as primary structural dividers (`1px solid #E2E8F0`), eliminating unnecessary interior whitespace margins between panes.

## Elevation & Depth

This design system rejects heavy, murky dropshadows in favor of razor-thin boundaries and luminous depth layering.

### Surface Tiers
- **Tier 0 (Base Canvas):** `#F8FAFC` — Houses the background shell of the entire client.
- **Tier 1 (Structural Panes):** `#FFFFFF` with `1px solid #E2E8F0` right/bottom border. Zero elevation blur; architectural separation is achieved strictly through structural borders.
- **Tier 2 (Interactive Overlays & Flyouts):** Dropdowns, quick-peek cards, context menus. Layered with `box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 2px 6px -1px rgba(15, 23, 42, 0.04)` enclosed by `1px solid #CBD5E1`.
- **Tier 3 (Floating Compose & Human-in-the-Loop Modals):** Center-anchored or bottom-right floating modals. `box-shadow: 0 20px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.06)`, bounded by `1px solid #94A3B8`.

### AI Copilot Radiant Glow
Elements driven or manipulated by the autonomous agent utilize an active energy signature instead of standard neutral shadows:
- **Agent Active Focus:** `0 0 0 1px #8B5CF6, 0 0 16px -2px rgba(139, 92, 246, 0.25)`
- **Tool Execution Pulse:** Keyframe breathing glow shifting between `#8B5CF6` (violet) and `#06B6D4` (cyan) along the border gradient.

## Shapes

The design system employs a disciplined **Soft (`0.25rem` / `4px`)** shape foundation to reflect an analytical, tool-grade instrument:
- **Control Elements (Buttons, Inputs, Row Highlights):** Built on `0.25rem` (`rounded-sm` / `rounded`).
- **Cards, Compose Surface, Copilot Cards:** Scaled up to `0.5rem` (`rounded-lg`) to soften larger floating boundaries.
- **Pills & Status Indicators:** Hard rounded full pills (`rounded-full`) reserved exclusively for numeric count tags, sync status pings, and keyboard shortcut glyphs.

## Components

### Buttons & Interactive Triggers
- **Primary:** Background `#4F46E5`, text `#FFFFFF`, hover `#4338CA`. Subtle inset top highlight: `inset 0 1px 0 0 rgba(255, 255, 255, 0.15)`. Radius: `0.25rem`. Height: `2rem` (32px) or `2.25rem` (36px).
- **Copilot Action:** Background: Linear gradient (`135deg, #4F46E5, #8B5CF6`). Text: `#FFFFFF`. Paired with a sparkle or lightning icon. Hover increases saturation and displays a `0 0 12px rgba(139, 92, 246, 0.4)` bloom.
- **Ghost / Tool Buttons:** Transparent background, text `#475569`, hover background `#F1F5F9`, hover text `#0F172A`.

### Actionable AI Execution Banners & Chips
- **Function Call Chip:** Inline code pill displaying automated client actions (e.g., `⚡ Executed openCompose()`, `⚡ Filter: Unread + Priority`). Monospace font (`JetBrains Mono`), font size `0.6875rem`. Border `1px solid rgba(139, 92, 246, 0.3)`, background `#F5F3FF`, text `#6D28D9`.
- **UI Manipulation Indicator:** When Copilot is actively navigating or adjusting the viewport, target containers receive a temporary dynamic border gradient ring (`#8B5CF6` to `#06B6D4`) accompanied by an ephemeral badge indicating the programmatic trigger.

### Thread List Items
- **Structure:** 3-row compact grid containing Sender + Real-time Timestamp, Subject + Tag Badges, and a single-line Snippet.
- **Read vs. Unread:** Unread threads display a `0.375rem` solid `#4F46E5` dot on the left margin, sender text at font weight `600`, and background `#FFFFFF`. Read threads feature sender text at font weight `400` with background `#F8FAFC` transitioning to `#FFFFFF` on hover.
- **Active Thread:** Indicated by an absolute `2px` vertical bar in `#4F46E5` along the left border and an active tint of `#EEF2FF`.

### Real-Time Sync Indicator
- Located in the bottom-left pane footer.
- Structure: Centered flex row with a `0.5rem` status dot, ping animation ring (`#10B981` at 75% opacity with infinite ping scale), accompanied by text `Pub/Sub Active` in `0.6875rem` weight `500` `#475569`, and tabular latency badge (e.g., `12ms`).

### Human-in-the-Loop Dialogs & Compose Window
- **Floating Compose:** Anchored bottom-right (`width: 38rem`, `height: 32rem`). Top tool strip includes Copilot auto-complete toggle, recipient fields with smart tag chips, and action footer.
- **Autonomous Confirmation Banner:** Displayed when AI generates actions involving external dispatch (e.g., "Schedule & Send to 14 participants"). Surface `#FFFBEB`, border `1px solid #FDE68A`, warning icon `#F59E0B`, displaying dual action triggers: `Approve [⌘⏎]` and `Revise`.