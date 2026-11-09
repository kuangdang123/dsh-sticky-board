/* ------------------------------------------------------------------ *
 * Sidebar integration: the footer launcher button and an optional tab in
 * the better-sidebar addon when that service is present.
 * ------------------------------------------------------------------ */

;(function () {
  'use strict'

  /* ------------------------------- styles --------------------------- */

  var SIDEBAR_CSS = [
    '.dsn-launcher { display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-sizing: border-box; height: 32px; min-width: 32px; padding: 0 8px; margin: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary, rgba(27, 27, 31, 0.62)); font-family: inherit; font-size: 13px; font-weight: 500; line-height: 1; white-space: nowrap; cursor: pointer; -webkit-user-select: none; user-select: none; transition: background-color 120ms ease, color 120ms ease; }',
    '.dsn-launcher:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06)); color: var(--dsw-alias-label-primary, #1b1b1f); }',
    '.dsn-launcher--on { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06)); color: var(--dsw-alias-label-primary, #1b1b1f); }',
    '.dsn-launcher:focus-visible { outline: 2px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16)); outline-offset: 2px; }',
    '.dsn-launcher--icon { width: 32px; padding: 0; }',
    '.dsn-launcher__icon { flex: none; }',
    '.dsn-launcher__label { display: inline-block; overflow: hidden; text-overflow: ellipsis; }',
    '.dsn-header-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; margin: 0; border: none; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary, rgba(27, 27, 31, 0.62)); cursor: pointer; flex: none; -webkit-app-region: no-drag; transition: background-color 120ms ease, color 120ms ease; }',
    '.dsn-header-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06)); color: var(--dsw-alias-label-primary, #1b1b1f); }',
    '.dsn-header-btn.is-on { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06)); color: var(--dsw-alias-label-primary, #1b1b1f); }',
    '.dsn-header-btn:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent, rgba(65, 118, 230, 0.48)); outline-offset: -1px; }',
  ].join('\n')

  try {
    if (typeof DSN.addCss === 'function') {
      DSN.addCss('sidebar', SIDEBAR_CSS)
    } else if (typeof DSN.injectStyle === 'function' && typeof document !== 'undefined' && document.head) {
      DSN.injectStyle(document, SIDEBAR_CSS)
    }
  } catch (error) {
    DSN.log('sidebar styles failed', error)
  }

  /* ------------------------------ helpers --------------------------- */

  function translateOf(value) {
    return typeof value === 'function' ? value : DSN.fallbackT
  }

  function readOpen(state) {
    return !!(state && state.ui && state.ui.open)
  }

  /** Reactive `store.ui.open` flag: `DSN.useStore` when available. */
  function useOpenState(store) {
    var React = DSN.React
    if (typeof DSN.useStore === 'function') {
      return readOpen(DSN.useStore(store))
    }
    if (!store || typeof store.getSnapshot !== 'function' || typeof store.subscribe !== 'function') return false
    if (React && typeof React.useSyncExternalStore === 'function') {
      if (typeof React.useCallback === 'function') {
        var subscribe = React.useCallback(function (listener) {
          return store.subscribe(listener)
        }, [store])
        var getSnapshot = React.useCallback(function () {
          return readOpen(store.getSnapshot())
        }, [store])
        return React.useSyncExternalStore(subscribe, getSnapshot)
      }
      return React.useSyncExternalStore(
        function (listener) { return store.subscribe(listener) },
        function () { return readOpen(store.getSnapshot()) },
      )
    }
    var pair = React.useState(function () { return readOpen(store.getSnapshot()) })
    React.useEffect(function () {
      return store.subscribe(function (state) {
        pair[1](readOpen(state))
      })
    }, [store])
    return pair[0]
  }

  /* ------------------------------ launcher -------------------------- */

  /**
   * Notes launcher. `variant: 'header'` renders the 28 px circle used by the
   * Session header utilities row; the default is the sidebar footer button.
   */
  DSN.SidebarLauncher = function SidebarLauncher(props) {
    var p = props || {}
    var store = p.store || null
    var t = translateOf(p.t)
    var wide = p.wide === true
    var header = p.variant === 'header'
    var open = useOpenState(store)
    var label = t('sidebar.launcher')

    function toggle(event) {
      try {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        if (!store || !store.actions || typeof store.actions.toggleOpen !== 'function') return
        store.actions.toggleOpen()
      } catch (error) {
        DSN.log('launcher toggle failed', error)
      }
    }

    var className = header
      ? 'dsn-header-btn' + (open ? ' is-on' : '')
      : 'dsn-launcher' + (wide ? '' : ' dsn-launcher--icon') + (open ? ' dsn-launcher--on' : '')

    return DSN.h('button', {
      type: 'button',
      className: className,
      title: label,
      'aria-label': label,
      'aria-pressed': open ? 'true' : 'false',
      'data-dsn-header-launcher': header ? '1' : undefined,
      onClick: toggle,
    },
      DSN.Icon({ name: 'note', size: header ? 16 : 16, className: header ? undefined : 'dsn-launcher__icon' }),
      header ? null : (wide ? DSN.h('span', { className: 'dsn-launcher__label' }, label) : null),
    )
  }

  /* ------------------------ session header entry -------------------- */

  /**
   * Register the launcher in the Session header's right-aligned utilities row.
   * `order: -20` puts it leftmost of that whole group of plugin and host
   * buttons, which is where the notes entrance belongs: it is the only global
   * toggle there, everything to its right is session-scoped.
   * @param options - `{ ctx, store, t }`.
   * @returns the disposer.
   */
  DSN.registerHeaderLauncher = function (options) {
    var opts = options || {}
    var ctx = opts.ctx || null
    var store = opts.store || null
    var t = translateOf(opts.t)
    if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return function () {}

    return ctx.slots.inject('conversation.session.header.utilities', function () {
      return ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-sticky-board-launcher',
        order: -20,
        locale: DSN.NS,
      }, function StickyNotesHeaderLauncher(props) {
        if (typeof DSN.SidebarLauncher !== 'function') return null
        return DSN.h(DSN.SidebarLauncher, {
          store: store,
          t: (props && props.t) || t,
          variant: 'header',
        })
      })
    })
  }

  /* -------------------------- better-sidebar tab -------------------- */

  /**
   * Register a full-height tab in the better-sidebar addon when the profile
   * provides its `betterSidebar` service. Returns null when the service or the
   * registerTab contract is missing.
   */
  DSN.registerBetterSidebarTab = function (options) {
    var opts = options || {}
    var ctx = opts.ctx || null
    var store = opts.store || null
    var t = translateOf(opts.t)

    var better = null
    if (ctx && typeof ctx.get === 'function') {
      try {
        better = ctx.get('betterSidebar')
      } catch (error) {
        DSN.log('betterSidebar service lookup failed', error)
      }
    }
    if (!better || typeof better.registerTab !== 'function') return null

    var registration = null
    try {
      registration = better.registerTab({
        id: 'dsh-sticky-board',
        title: t('sidebar.tabTitle'),
        description: t('sidebar.tabDescription'),
        icon: DSN.Icon({ name: 'note' }),
        order: 60,
        component: function StickyNotesSidebarTab(props) {
          if (typeof DSN.NotesApp !== 'function') return null
          return DSN.h(DSN.NotesApp, {
            store: store,
            t: t,
            bridge: DSN.bridge || null,
            ctx: ctx,
          })
        },
      })
    } catch (error) {
      DSN.log('better-sidebar tab registration failed', error)
      return null
    }

    if (typeof registration === 'function') return registration
    if (registration && typeof registration.dispose === 'function') {
      return function dispose() {
        try {
          registration.dispose()
        } catch (error) {
          DSN.log('better-sidebar tab dispose failed', error)
        }
      }
    }
    return function () {}
  }
})()
