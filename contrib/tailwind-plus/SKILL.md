---
name: tailwind-plus
description: >
  This skill should be used when the user asks to "add a component", "use a
  Tailwind Plus component", "build a UI", "create a form", "add a modal", "add
  a sidebar", "create a landing page", or needs any UI component from Tailwind
  Plus (formerly Tailwind UI). Use this when building pages, layouts, or UI
  elements with Tailwind CSS.
allowed-tools: Glob, Read, Bash(jq *)
---

# Tailwind Plus Components

## Detect format and load workflow

Use `Glob` to detect which format is available:

- Directory format: `tailwindplus-components-????-??-??-??????/metadata.json`
- JSON format: `tailwindplus-components-????-??-??-??????.json`

Either may use a custom name if `--output` was specified during download.

Then `Read` the appropriate workflow file from the same directory as this SKILL.md:

- Directory format → `instructions-dir.md`
- JSON format → `instructions-json.md`

## Component catalog

### Application UI
- **Application Shells**: Multi-Column Layouts, Sidebar Layouts, Stacked Layouts
- **Data Display**: Calendars, Description Lists, Stats
- **Elements**: Avatars, Badges, Button Groups, Buttons, Dropdowns
- **Feedback**: Alerts, Empty States
- **Forms**: Action Panels, Checkboxes, Comboboxes, Form Layouts, Input Groups, Radio Groups, Select Menus, Sign-in and Registration, Textareas, Toggles
- **Headings**: Card Headings, Page Headings, Section Headings
- **Layout**: Cards, Containers, Dividers, List containers, Media Objects
- **Lists**: Feeds, Grid Lists, Stacked Lists, Tables
- **Navigation**: Breadcrumbs, Command Palettes, Navbars, Pagination, Progress Bars, Sidebar Navigation, Tabs, Vertical Navigation
- **Overlays**: Drawers, Modal Dialogs, Notifications
- **Page Examples**: Detail Screens, Home Screens, Settings Screens

### Ecommerce
- **Components**: Category Filters, Category Previews, Checkout Forms, Incentives, Order History, Order Summaries, Product Features, Product Lists, Product Overviews, Product Quickviews, Promo Sections, Reviews, Shopping Carts, Store Navigation
- **Page Examples**: Category Pages, Checkout Pages, Order Detail Pages, Order History Pages, Product Pages, Shopping Cart Pages, Storefront Pages

### Marketing
- **Elements**: Banners, Flyout Menus, Headers
- **Feedback**: 404 Pages
- **Page Examples**: About Pages, Landing Pages, Pricing Pages
- **Page Sections**: Bento Grids, Blog Sections, CTA Sections, Contact Sections, Content Sections, FAQs, Feature Sections, Footers, Header Sections, Hero Sections, Logo Clouds, Newsletter Sections, Pricing Sections, Stats, Team Sections, Testimonials
