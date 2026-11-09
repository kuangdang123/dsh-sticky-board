// Sticky notes — browser half.
//
// Loaded by dsh-client-modules at /plugins/dsh-sticky-board/client.js and run
// through the shell's lazy-CJS module table (`window.__ModuleLoader__.load`).
// Everything below shares ONE factory scope: each `src/*.js` fragment assigns
// onto the `DSN` namespace object declared here, so no fragment needs imports.
window.__ModuleLoader__.load({
  id: 'dsh-sticky-board',
  factory: function (require) {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var ReactDOMClient = require('react-dom/client')

    var h = React.createElement
    var DSN = {}
    DSN.React = React
    DSN.ReactDOM = ReactDOMClient
    DSN.h = h
    DSN.VERSION = '0.1.0'
