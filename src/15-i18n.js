/* ------------------------------------------------------------------ *
 * Copy dictionaries. Every user-visible string in this plugin lives here;
 * components receive `t` (the locale service's bound translate function).
 * `zh` is the key source of truth, `en` must carry the same keys.
 * ------------------------------------------------------------------ */

DSN.zh = {
  'panel.title': '便签',
  'panel.close': '关闭面板',
  'panel.collapse': '收起',
  'panel.expand': '展开',
  'panel.pip': '画中画（置顶悬浮窗）',
  'panel.dragHint': '拖动标题栏移动，拖动右下角调整大小',

  'tab.all': '全部',
  'tab.trash': '回收站',

  'section.inbox': '收件箱',
  'section.add': '新建分区',
  'section.rename': '重命名分区',
  'section.delete': '删除分区',
  'section.namePlaceholder': '分区名称',
  'section.deleteHint': '分区内的便签会移到第一个分区',
  'section.count': '{n} 条',

  'composer.placeholder': '记一条…  可直接粘贴图片/表格，也可以从对话里拖进来',
  'composer.save': '保存',
  'composer.saveHint': 'Ctrl+Enter 保存',
  'composer.richHint': '支持富文本、代码、表格、图片',

  'note.copy': '复制',
  'note.insert': '插入到输入框',
  'note.pin': '置顶',
  'note.unpin': '取消置顶',
  'note.edit': '编辑',
  'note.save': '保存修改',
  'note.cancel': '取消',
  'note.delete': '删除',
  'note.restore': '恢复',
  'note.purge': '彻底删除',
  'note.empty': '停用',
  'note.saved': '已存入便签',
  'note.updated': '已更新便签',
  'note.dragHint': '拖动可排序 / 归档到其他分区',

  'search.placeholder': '搜索便签…',
  'search.clear': '清除搜索',

  'list.empty': '还没有便签。选中对话里的内容后点「存便签」，或在上方直接记录。',
  'list.emptySection': '这个分区还是空的。',
  'list.trashEmpty': '回收站是空的。',
  'list.count': '{n} 条便签',
  'list.pinned': '置顶',
  'list.source': '来自 {name}',

  'trash.dropHint': '拖到这里删除',
  'trash.emptyAll': '清空回收站',
  'trash.confirmEmpty': '彻底删除回收站里的全部便签？',

  'capture.chip': '存便签',
  'capture.chipTitle': '把选中的内容存入便签 (Alt+Shift+S)',
  'capture.quote': '引用文本',
  'capture.dropHere': '松手存入便签',
  'capture.dropRich': '拖入文本 / 表格 / 图片',

  'status.storageFull': '便签存储已满，请清理回收站或删除部分便签',
  'status.copyFailed': '复制失败，请手动选中复制',
  'status.copied': '已复制',
  'status.inserted': '已插入到输入框',
  'status.noSession': '当前没有可插入的会话，已复制到剪贴板',

  'sync.idle': '本地',
  'sync.loading': '正在读取已保存的便签…',
  'sync.saving': '保存中…',
  'sync.saved': '已保存',
  'sync.local': '仅浏览器本地',
  'sync.error': '保存失败',
  'sync.title': '便签保存在本机文件中；点击可立即保存',

  'pip.unsupported': '当前浏览器不支持画中画窗口',
  'pip.title': '便签 · 置顶窗口',

  'sidebar.launcher': '便签',
  'sidebar.tabTitle': '便签',
  'sidebar.tabDescription': '随手记录与跨会话搬运',

  'shortcuts.hint': 'Alt+Shift+N 打开/关闭便签 · Alt+Shift+S 存选区',

  'time.justNow': '刚刚',
  'time.minutes': '{n} 分钟前',
  'time.hours': '{n} 小时前',
  'time.days': '{n} 天前',

  'kind.text': '文本',
  'kind.table': '表格',
  'kind.image': '图片',
  'kind.code': '代码',
  'kind.mixed': '混合',
  'kind.link': '链接',
}

DSN.en = {
  'panel.title': 'Sticky notes',
  'panel.close': 'Close panel',
  'panel.collapse': 'Collapse',
  'panel.expand': 'Expand',
  'panel.pip': 'Picture-in-picture (always on top)',
  'panel.dragHint': 'Drag the header to move, drag the corner to resize',

  'tab.all': 'All',
  'tab.trash': 'Trash',

  'section.inbox': 'Inbox',
  'section.add': 'New section',
  'section.rename': 'Rename section',
  'section.delete': 'Delete section',
  'section.namePlaceholder': 'Section name',
  'section.deleteHint': 'Notes in it move to the first section',
  'section.count': '{n}',

  'composer.placeholder': 'Write a note… paste images or tables, or drag content here',
  'composer.save': 'Save',
  'composer.saveHint': 'Ctrl+Enter to save',
  'composer.richHint': 'Rich text, code, tables and images are kept',

  'note.copy': 'Copy',
  'note.insert': 'Insert into composer',
  'note.pin': 'Pin',
  'note.unpin': 'Unpin',
  'note.edit': 'Edit',
  'note.save': 'Save changes',
  'note.cancel': 'Cancel',
  'note.delete': 'Delete',
  'note.restore': 'Restore',
  'note.purge': 'Delete forever',
  'note.empty': 'Disable',
  'note.saved': 'Saved to notes',
  'note.updated': 'Note updated',
  'note.dragHint': 'Drag to reorder or move to another section',

  'search.placeholder': 'Search notes…',
  'search.clear': 'Clear search',

  'list.empty': 'No notes yet. Select something in a conversation and press "Save note", or write one above.',
  'list.emptySection': 'This section is empty.',
  'list.trashEmpty': 'The trash is empty.',
  'list.count': '{n} notes',
  'list.pinned': 'Pinned',
  'list.source': 'from {name}',

  'trash.dropHint': 'Drop here to delete',
  'trash.emptyAll': 'Empty trash',
  'trash.confirmEmpty': 'Permanently delete every note in the trash?',

  'capture.chip': 'Save note',
  'capture.chipTitle': 'Save the selection as a sticky note (Alt+Shift+S)',
  'capture.quote': 'Quote text',
  'capture.dropHere': 'Drop to save a note',
  'capture.dropRich': 'Drop text / tables / images',

  'status.storageFull': 'Note storage is full — empty the trash or delete some notes',
  'status.copyFailed': 'Copy failed, please select and copy manually',
  'status.copied': 'Copied',
  'status.inserted': 'Inserted into the composer',
  'status.noSession': 'No chat to insert into — copied to the clipboard instead',

  'sync.idle': 'Local',
  'sync.loading': 'Reading saved notes…',
  'sync.saving': 'Saving…',
  'sync.saved': 'Saved',
  'sync.local': 'Browser only',
  'sync.error': 'Save failed',
  'sync.title': 'Notes are saved to a file on this machine; click to save now',

  'pip.unsupported': 'This browser does not support picture-in-picture windows',
  'pip.title': 'Sticky notes · always on top',

  'sidebar.launcher': 'Sticky notes',
  'sidebar.tabTitle': 'Sticky notes',
  'sidebar.tabDescription': 'Quick capture and cross-session hand-off',

  'shortcuts.hint': 'Alt+Shift+N toggles notes · Alt+Shift+S saves the selection',

  'time.justNow': 'just now',
  'time.minutes': '{n}m ago',
  'time.hours': '{n}h ago',
  'time.days': '{n}d ago',

  'kind.text': 'Text',
  'kind.table': 'Table',
  'kind.image': 'Image',
  'kind.code': 'Code',
  'kind.mixed': 'Mixed',
  'kind.link': 'Link',
}

DSN.dicts = { zh: DSN.zh, en: DSN.en }

/**
 * Later fragments add their own copy here (called at load time, before
 * `apply()` registers the dictionaries), so each file owns its strings.
 */
DSN.addStrings = function (zh, en) {
  Object.keys(zh || {}).forEach(function (key) { DSN.dicts.zh[key] = zh[key] })
  Object.keys(en || {}).forEach(function (key) { DSN.dicts.en[key] = en[key] })
}

/** Fallback translator for the window before the locale service answers. */
DSN.fallbackT = function (key, params) {
  var table = DSN.dicts[DSN.defaultLang || 'zh'] || DSN.zh
  var template = table[key] != null ? table[key] : (DSN.zh[key] != null ? DSN.zh[key] : key)
  if (!params) return template
  return String(template).replace(/\{(\w+)\}/g, function (match, name) {
    return name in params ? String(params[name]) : match
  })
}
