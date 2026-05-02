---
name: new-angular-component
description: "Create a new standalone Angular component for the stgntFrontend project. Use when adding a new page, admin panel section, form, or UI widget. Handles file scaffolding, brand SCSS setup, route registration, and service wiring."
argument-hint: "Component name and purpose, e.g. 'confession-list — admin list of confession requests'"
---

# New Angular Component

## When to Use
- Adding a new page or feature to the Angular frontend
- Creating a new admin panel section
- Building a new form (prayer request, visitation, etc.)
- Adding a new public-facing view

## Procedure

### 1. Understand Requirements
- Confirm the component name (kebab-case) and its purpose.
- Determine if it is a public page or admin-only (needs `authGuard`).
- Identify what data it needs and which backend routes to call.

### 2. Check for Existing Patterns
- Search `src/app/components/` for a similar component to reuse structure.
- Check `src/app/services/` for an existing service that already calls the needed API.

### 3. Create the Four Component Files under `src/app/components/<name>/`

**`<name>.component.ts`**
```ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-<name>',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './<name>.component.html',
  styleUrls: ['./<name>.component.scss']
})
export class <Name>Component implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  ngOnInit(): void {}
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }
}
```

**`<name>.component.scss`** — brand variables at top:
```scss
$primary-color:    #8b181d;
$secondary-color:  #ff6b6b;
$accent-color:     #d4af37;
$white:            #ffffff;
$text-dark:        #2c3e50;
$text-light:       #6c757d;
$gradient-primary: linear-gradient(135deg, $primary-color 0%, $secondary-color 100%);
```

**`<name>.component.html`**
```html
<div class="<name>-container">
  <div class="page-header">
    <h1 class="page-title">Title</h1>
  </div>
  <!-- content -->
</div>
```

### 4. Register the Route in `src/app/app.routes.ts`
```ts
// Public:
{ path: 'routePath', component: <Name>Component }
// Admin (lazy + guard):
{ path: 'admin/routePath', loadComponent: () => import('./components/<name>/<name>.component').then(m => m.<Name>Component), canActivate: [authGuard] }
```

### 5. Wire Up Service Calls
- Inject the service via constructor.
- Use `takeUntil(destroy$)` on all subscriptions.
- Disable submit buttons when `form.invalid || isLoading`.
