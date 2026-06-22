# Pacer UI Guidelines

## Product Direction

Pacer is a rally cockpit first and an editor second. In drive mode the driver must see the car, the road ahead, the active call, speed, timing, and telemetry without scrolling. Setup, route editing, note editing, and simulator tuning can scroll because those are not in-motion workflows.

## Layout Rules

- Mobile drive mode is a full-screen cockpit: map full bleed, active call at the safe-area top, controls and telemetry at the safe-area bottom.
- Phone setup mode uses one primary navigation model: a bottom dock for Home, Garage, Stage, Debrief, and Settings. Do not duplicate that same navigation in a top hamburger.
- Tablet setup mode uses a compact drawer or rail for primary navigation and keeps the bottom edge free for content.
- Mobile setup mode is a tabbed app workspace inside the selected section: route, map, co-driver, and shakedown are separate surfaces. Do not stack all editor surfaces in one scroll.
- Desktop setup mode can show all three work zones together: setup, map, notes/simulator.
- Desktop drive mode keeps the full cockpit HUD because there is enough width to avoid covering the road ahead.
- Keep controls at least 44 px tall in mobile drive mode.
- Keep repeated cards and panels at 8 px radius or less.
- Do not use explanatory app text in the cockpit. Labels are only telemetry identifiers, note states, or control titles.
- Use icon-first labels in dense editor navigation. Hide text before allowing a label to wrap; keep the accessible name and tooltip.

## Visual Rules

- Use shadcn-vue/Reka primitives for accessible controls: buttons, sheets, tabs, inputs, selects, switches, badges, tooltips, dialogs, and future sliders.
- Use Pacer custom surfaces for the product identity: service-park modules, compact stat strips, status rails, telemetry panels, and garage dossiers. Do not rely on a generic component-library card aesthetic for primary screens.
- Use custom rally components where the domain requires them: map, cockpit HUD, pacenote icons, route markers, ghost progress, and telemetry bars.
- Use dark cockpit surfaces with high-contrast white text and color-coded pace call severity. The app shell should feel like a Gran Turismo garage/service-park flow attached to a WRC cockpit, not a generic admin dashboard.
- Keep map labels, route, pacenote markers, and the car marker aligned in both north-up and heading-up modes.
- Preserve road-ahead visibility. The car sits below center in drive mode; any lateral lead must favor the next turn and remain subtle.
- Avoid decorative blurred dots, orbs, large marketing heroes, and nested cards. Use racing trim instead: thin keylines, amber section rails, checker/kerb accents where they carry meaning, and real car/stage imagery where available.
- Palette: graphite/tarmac base, white telemetry text, amber primary action, cyan telemetry, green live/ok, red caution/late, and red-white kerbs only for route context.

## Component Map

- shadcn-vue: button, badge, sheet, input, select, switch, tabs, tooltip, separator, card only for repeated items or true framed tools.
- Pacer surfaces: top shell, phone rail, service-park modules, stat strips, status dots, garage dossier, alerts, update prompts, and dense form grids.
- Custom WRC/GT: driver HUD, pacenote train, pace call icons, speed dial, telemetry bars, MapLibre route layers, kerbs, ghost progress, vehicle signal, and tuning-sheet density.
- Custom components must keep transform/opacity motion, tabular numeric readouts, and stable dimensions so drive mode does not jump during speech, route updates, or sensor changes.

## Breakpoints

- Phone: `(max-width: 639px)` or short landscape viewports use the bottom dock, compact top status, and icon-first secondary tabs.
- Tablet: non-desktop, non-phone viewports use the hamburger drawer or future left rail. No bottom dock.
- Desktop: `1024px+` uses the top primary tabs and the three-zone Stage workspace.

## Motion Rules

- Smooth car position, heading, and map center independently from tile loading.
- Heading-up rotation must not expose empty tile edges at normal driving zoom.
- Scrolling note lists should follow the active spoken note automatically.

## Backend Split

- Keep Vue and TypeScript for the UI, browser device APIs, and PWA shell.
- Move CPU-heavy or device-facing services to Rust when they become independent processes: pacenote generation, route analysis, OBD telemetry bridge, TTS broker, timing sessions, ghost comparison, and offline map preprocessing.
