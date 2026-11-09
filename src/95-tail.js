    exports.name = 'dsh-sticky-board'
    exports.apply = DSN.apply
    exports.inject = DSN.inject
    DSN.log('module registered', DSN.VERSION)
    return module.exports
  },
})
