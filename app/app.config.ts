// Thème @nuxt/ui de Brandself.
//
// Les couleurs ne passent PAS par `ui.colors` : cette clé n'accepte que des noms
// de palettes Tailwind, alors que nos couleurs sont les variables CSS des
// palettes de vitrine (Terracotta, Sauge, Indigo, Ocre, Bordeaux). Le pont est
// dans `assets/css/main.css` : les variables `--ui-*` de @nuxt/ui y pointent
// vers `var(--accent)`, `var(--encre)`, etc. Changer de palette change donc tout.
//
// Ici : formes, tailles et états des composants, exprimés avec les variables de
// gabarit (`--rayon`, `--hauteur-controle`, `--cible-tactile`…).
export default defineAppConfig({
  ui: {
    // Phosphor uniquement (CLAUDE.md §5) : on remplace les icônes Lucide par défaut.
    icons: {
      arrowDown: 'i-ph-arrow-down',
      arrowLeft: 'i-ph-arrow-left',
      arrowRight: 'i-ph-arrow-right',
      arrowUp: 'i-ph-arrow-up',
      caution: 'i-ph-warning-circle',
      check: 'i-ph-check',
      chevronDoubleLeft: 'i-ph-caret-double-left',
      chevronDoubleRight: 'i-ph-caret-double-right',
      chevronDown: 'i-ph-caret-down',
      chevronLeft: 'i-ph-caret-left',
      chevronRight: 'i-ph-caret-right',
      chevronUp: 'i-ph-caret-up',
      close: 'i-ph-x',
      copy: 'i-ph-copy',
      copyCheck: 'i-ph-check',
      dark: 'i-ph-moon',
      drag: 'i-ph-dots-six-vertical',
      ellipsis: 'i-ph-dots-three',
      error: 'i-ph-x-circle',
      external: 'i-ph-arrow-up-right',
      eye: 'i-ph-eye',
      eyeOff: 'i-ph-eye-slash',
      file: 'i-ph-file',
      folder: 'i-ph-folder',
      folderOpen: 'i-ph-folder-open',
      hash: 'i-ph-hash',
      info: 'i-ph-info',
      light: 'i-ph-sun',
      loading: 'i-ph-circle-notch',
      menu: 'i-ph-list',
      minus: 'i-ph-minus',
      panelClose: 'i-ph-sidebar-simple',
      panelOpen: 'i-ph-sidebar-simple',
      plus: 'i-ph-plus',
      reload: 'i-ph-arrow-counter-clockwise',
      search: 'i-ph-magnifying-glass',
      stop: 'i-ph-stop',
      star: 'i-ph-star',
      success: 'i-ph-check-circle',
      system: 'i-ph-desktop',
      tip: 'i-ph-lightbulb',
      upload: 'i-ph-upload-simple',
      warning: 'i-ph-warning',
    },

    button: {
      slots: {
        base: 'rounded-(--rayon) font-semibold',
      },
      variants: {
        size: {
          // Action principale : 56 px de haut.
          xl: { base: 'min-h-(--hauteur-controle) px-6 text-base' },
          // Lien / action secondaire : cible tactile de 44 px.
          lg: { base: 'min-h-(--cible-tactile) px-3 text-base' },
        },
      },
      compoundVariants: [
        {
          color: 'primary',
          variant: 'solid',
          class:
            'hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--encre))] active:bg-[color-mix(in_srgb,var(--accent)_88%,var(--encre))]',
        },
      ],
      defaultVariants: { size: 'xl' },
    },

    input: {
      slots: {
        root: 'w-full',
        base: 'rounded-(--rayon) hover:not-disabled:ring-(color:--texte-secondaire)',
      },
      variants: {
        size: {
          xl: {
            base: 'min-h-(--hauteur-controle) px-4 text-base',
            leading: 'ps-4',
            trailing: 'pe-4',
          },
        },
      },
      defaultVariants: { size: 'xl' },
    },

    select: {
      slots: {
        base: 'w-full rounded-(--rayon) hover:not-disabled:ring-(color:--texte-secondaire)',
        content: 'rounded-(--rayon-interne)',
      },
      variants: {
        size: {
          xl: { base: 'min-h-(--hauteur-controle) px-4 text-base', item: 'min-h-(--cible-tactile) items-center text-base' },
        },
      },
      defaultVariants: { size: 'xl' },
    },

    pinInput: {
      slots: {
        root: 'flex w-full gap-2',
        base: 'rounded-(--rayon) font-bold font-(family-name:--font-titre) hover:not-disabled:ring-(color:--texte-secondaire)',
      },
      variants: {
        size: {
          // Six cases égales qui se partagent la largeur : 64 px de haut.
          xl: { base: 'h-16 w-auto min-w-0 flex-1 text-(length:--fs-24)' },
        },
      },
      defaultVariants: { size: 'xl' },
    },

    formField: {
      slots: {
        label: 'text-base font-semibold',
      },
      variants: {
        orientation: {
          vertical: { container: 'mt-2' },
        },
      },
      defaultVariants: { size: 'xl' },
    },

    // Choix exclusif segmenté (canal de connexion, mode d'envoi).
    tabs: {
      slots: {
        list: 'gap-1 rounded-(--rayon) border border-default',
        indicator: 'rounded-(--rayon-interne)',
        trigger:
          'min-h-(--cible-tactile) rounded-(--rayon-interne) data-[state=inactive]:text-default data-[state=active]:font-semibold',
      },
      defaultVariants: { size: 'xl' },
    },

    // Réglage oui/non : zone tactile de 44 px même sans libellé.
    switch: {
      slots: {
        root: 'min-h-(--cible-tactile) items-center',
        label: 'text-base font-medium',
        description: 'text-sm',
      },
    },

    separator: {
      slots: {
        label: 'text-sm text-muted font-normal',
      },
    },

    // Message d'erreur : icône + texte rouge en gras, sans cadre (maquettes).
    alert: {
      slots: {
        description: 'text-base font-semibold opacity-100',
        icon: 'mt-0.5',
      },
      compoundVariants: [
        {
          color: 'error',
          variant: 'soft',
          class: { root: 'items-start bg-transparent p-0' },
        },
      ],
    },
  },
})
