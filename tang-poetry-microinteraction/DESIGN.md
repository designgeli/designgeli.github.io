# Design System: The Ethereal Manuscript

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Inkstone"**
This design system moves beyond the "app as a tool" and treats the interface as a living piece of digital calligraphy. It is designed to bridge the thousand-year gap between Tang Dynasty scrolls and contemporary glass-and-silicon interfaces.

By rejecting the rigid, boxy constraints of standard mobile frameworks, this system employs **intentional asymmetry** and **vertical rhythm**. We break the "template" look by using deep, immersive gradients that mimic the way ink bleeds into silk, and by utilizing high-contrast typography scales that prioritize the poem as a sacred object. The goal is to create a "Reading Sanctuary" that feels quiet, premium, and deeply intentional.

---

## 2. Colors
Our palette is a dialogue between the "Deep Charcoal" of fresh ink and the "Warm Gold" of weathered parchment.

*   **Primary (Ink & Night):** `primary` (#bac7e2) and `primary_container` (#0d1a2e). Use these for the core "ink" feel and deep background layers.
*   **Secondary (Gilded Accents):** `secondary` (#e4c199) and `secondary_container` (#5d4426). These tokens are reserved for highlights, reflecting the gold leaf used in ancient manuscripts.
*   **Neutral Surface:** `surface` (#0c1420) provides the void in which the poetry lives.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section content. Boundaries must be defined solely through background color shifts. To separate a poem’s metadata from its body, use a shift from `surface_container_low` to `surface_container`. Lines interrupt the "flow" of the ink; color transitions preserve it.

### Surface Hierarchy & Nesting
Treat the UI as stacked sheets of fine paper.
*   **Base:** `surface_dim` (#0c1420).
*   **Primary Content Area:** `surface_container_low`.
*   **Interactive Cards:** `surface_container_high`.
*   **Floating Navigation:** `surface_bright` with 80% opacity.

### The "Glass & Gradient" Rule
To achieve the "Micro-Interaction" feel, use **Glassmorphism** for the bottom interaction bars. Apply `surface_container_highest` with a 20px backdrop blur. For the "Immersive Reading Zone," use a radial gradient transitioning from `primary_container` (#0d1a2e) in the center to `surface` (#0c1420) at the edges to pull the user's eye toward the text.

---

## 3. Typography
The typography is a curated editorial experience, balancing the weight of history with the precision of modern code.

*   **The Poetry (Noto Serif TC):** Used for all `display`, `headline`, and `body` scales. It provides the "soul." Increase line-height to 1.8x for poetry body text to mimic the airy quality of traditional scrolls.
*   **The Interface (Noto Sans TC):** Used for `title` and `label` scales. It provides the "utility." It should be clean, legible, and secondary to the poetry.
*   **The Metadata (JetBrains Mono):** Used for tags and timestamps. This monospaced font creates a deliberate "modern cataloging" aesthetic, contrasting the organic serif of the poems.

**Scale Highlight:** 
- `display-lg`: 3.5rem (Use for single-character thematic headers).
- `body-lg`: 1rem (The standard for poetry reading).

---

## 4. Elevation & Depth
Depth in this system is atmospheric, not architectural.

*   **The Layering Principle:** Avoid shadows where possible. Instead, stack `surface_container_lowest` cards on `surface_container_low` sections. This creates a "soft lift" that feels like paper resting on a desk.
*   **Ambient Shadows:** When an element must float (e.g., a "Share" modal), use a shadow with a 40px blur, 0% spread, and 6% opacity of `on_surface`. This mimics natural ambient light.
*   **The "Ghost Border" Fallback:** If accessibility requires a container edge, use `outline_variant` at 15% opacity. Never use a 100% opaque border.
*   **Glassmorphism:** Navigation bars should use the `surface_container_highest` token at 70% opacity with a heavy backdrop blur (16px+). This allows the colors of the poem to "bleed" into the UI as the user scrolls.

---

## 5. Components

### Card-Based Selector
*   **Visuals:** Forgo borders. Use `surface_container_high` backgrounds.
*   **Interaction:** On hover/touch, the card should scale slightly (1.02x) and the background should shift toward `secondary_container` to provide a "golden glow."

### Bottom Interaction Bars
*   **Style:** A single, continuous "frosted glass" slab. 
*   **Tokens:** `surface_container_highest` (semi-transparent) + `on_surface_variant` for icons.
*   **Design Note:** Forgo icons with boxes; use "Ghost" style icons that feel etched into the glass.

### Mood Chips
*   **Visuals:** Use the "Spectrum of Moods" (e.g., `tertiary` for peaceful-green).
*   **Shape:** Use `rounded-full` for a soft, pebble-like feel. No outline; use a subtle `surface_variant` fill.

### Immersive Reading Zone
*   **Layout:** Content should be centered with wide margins (at least 24dp).
*   **Transitions:** When switching poems, use a "Cross-Dissolve + Vertical Slide" (200ms) to mimic the unrolling of a scroll.

---

## 6. Do's and Don'ts

### Do:
*   **Do** use vertical white space (from the spacing scale) instead of dividers.
*   **Do** use `secondary` (Gold) sparingly—only for the "Primary Action" or a "Featured" poem title.
*   **Do** prioritize the vertical rhythm; ensure the space between the title and the first line of poetry is exactly `headline-lg` height.

### Don't:
*   **Don't** use pure black (#000000). Always use `surface_dim` (#0c1420) to maintain tonal depth.
*   **Don't** use high-contrast shadows. If the user can "see" the shadow, it's too dark.
*   **Don't** use Noto Sans for the poetry text. The serif's "stroke" is essential to the calligraphic identity.
*   **Don't** use more than three mood colors on a single screen. Maintain the "Minimalist" promise.