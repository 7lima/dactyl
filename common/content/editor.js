// Copyright (c) 2008-2011 Kris Maglione <maglione.k at Gmail>
// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

// command names taken from:
// http://developer.mozilla.org/en/docs/Editor_Embedding_Guide

/** @instance editor */
var Editor = Module("editor", {
    init: function init(elem) {
        if (elem)
            this.element = elem;
        else
            this.__defineGetter__("element", function () {
                let elem = dactyl.focusedElement;
                if (elem)
                    return elem.inputField || elem;

                let win = document.commandDispatcher.focusedWindow;
                return DOM(win).isEditable && win || null;
            });
    },

    get editor() DOM(this.element).editor,

    getController: function getController(cmd) {
        let controllers = this.element && this.element.controllers;
        dactyl.assert(controllers);

        return controllers.getControllerForCommand(cmd || "cmd_beginLine");
    },

    get selection() this.editor && this.editor.selection || null,

    get isCaret() modes.getStack(1).main == modes.CARET,
    get isTextEdit() modes.getStack(1).main == modes.TEXT_EDIT,

    deselectText: function () {
        if (this.selection)
            this.selection.collapse(this.selection.focusNode,
                                    this.selection.focusOffset);
    },

    get selectedText() String(this.selection),

    pasteClipboard: function (clipboard, toStart) {
        let elem = this.element;

        if (elem.setSelectionRange) {
            let text = dactyl.clipboardRead(clipboard);
            if (!text)
                return;
            if (isinstance(elem, [HTMLInputElement, XULTextBoxElement]))
                text = text.replace(/\n+/g, "");

            // This is a hacky fix - but it works.
            // <s-insert> in the bottom of a long textarea bounces up
            let top = elem.scrollTop;
            let left = elem.scrollLeft;

            let start = elem.selectionStart; // caret position
            let end = elem.selectionEnd;
            let value = elem.value.substring(0, start) + text + elem.value.substring(end);
            elem.value = value;

            if (/^(search|text)$/.test(elem.type))
                DOM(elem).rootElement.firstChild.textContent = value;

            elem.selectionStart = Math.min(start + (toStart ? 0 : text.length), elem.value.length);
            elem.selectionEnd = elem.selectionStart;

            elem.scrollTop = top;
            elem.scrollLeft = left;

            DOM(elem).input();
        }
    },

    // count is optional, defaults to 1
    executeCommand: function (cmd, count) {
        let controller = this.getController(cmd);
        dactyl.assert(callable(cmd) ||
                          controller &&
                          controller.supportsCommand(cmd) &&
                          controller.isCommandEnabled(cmd));

        // XXX: better as a precondition
        if (count == null)
          count = 1;

        let didCommand = false;
        while (count--) {
            // some commands need this try/catch workaround, because a cmd_charPrevious triggered
            // at the beginning of the textarea, would hang the doCommand()
            // good thing is, we need this code anyway for proper beeping
            try {
                if (callable(cmd))
                    cmd(this.editor, controller);
                else
                    controller.doCommand(cmd);
                didCommand = true;
            }
            catch (e) {
                util.reportError(e);
                dactyl.assert(didCommand);
                break;
            }
        }
    },

    moveToPosition: function (pos, select) {
        let node = this.selection.focusNode;
        this.selection[select ? "extend" : "collapse"](node, pos);
    },

    findChar: function (key, count, backward) {

        util.assert(DOM(this.element).isInput);

        // XXX
        if (count == null)
            count = 1;

        let code = DOM.Event.parse(key)[0].charCode;
        util.assert(code);

        let char = String.fromCharCode(code);

        let text = this.element.value;
        let caret = this.element.selectionEnd;
        if (backward) {
            let end = text.lastIndexOf("\n", caret);
            while (caret > end && caret >= 0 && count--)
                caret = text.lastIndexOf(char, caret - 1);
        }
        else {
            let end = text.indexOf("\n", caret);
            if (end == -1)
                end = text.length;

            while (caret < end && caret >= 0 && count--)
                caret = text.indexOf(char, caret + 1);
        }

        if (count > 0)
            caret = -1;
        if (caret == -1)
            dactyl.beep();
        return caret;
    },

    /**
     * Edits the given file in the external editor as specified by the
     * 'editor' option.
     *
     * @param {object|File|string} args An object specifying the file, line,
     *     and column to edit. If a non-object is specified, it is treated as
     *     the file parameter of the object.
     * @param {boolean} blocking If true, this function does not return
     *     until the editor exits.
     */
    editFileExternally: function (args, blocking) {
        if (!isObject(args) || args instanceof File)
            args = { file: args };
        args.file = args.file.path || args.file;

        let args = options.get("editor").format(args);

        dactyl.assert(args.length >= 1, _("option.notSet", "editor"));

        io.run(args.shift(), args, blocking);
    },

    // TODO: clean up with 2 functions for textboxes and currentEditor?
    editFieldExternally: function editFieldExternally(forceEditing) {
        if (!options["editor"])
            return;

        let textBox = config.isComposeWindow ? null : dactyl.focusedElement;
        if (!DOM(textBox).isInput)
            textBox = null;

        let line, column;
        let keepFocus = modes.stack.some(function (m) isinstance(m.main, modes.COMMAND_LINE));

        if (!forceEditing && textBox && textBox.type == "password") {
            commandline.input(_("editor.prompt.editPassword") + " ",
                function (resp) {
                    if (resp && resp.match(/^y(es)?$/i))
                        editor.editFieldExternally(true);
                });
                return;
        }

        if (textBox) {
            var text = textBox.value;
            var pre = text.substr(0, textBox.selectionStart);
        }
        else {
            var editor_ = window.GetCurrentEditor ? GetCurrentEditor()
                                                  : Editor.getEditor(document.commandDispatcher.focusedWindow);
            dactyl.assert(editor_);
            text = Array.map(editor_.rootElement.childNodes, function (e) DOM.stringify(e, true)).join("");

            if (!editor_.selection.rangeCount)
                var sel = "";
            else {
                let range = RangeFind.nodeContents(editor_.rootElement);
                let end = editor_.selection.getRangeAt(0);
                range.setEnd(end.startContainer, end.startOffset);
                pre = DOM.stringify(range, true);
                if (range.startContainer instanceof Text)
                    pre = pre.replace(/^(?:<[^>"]+>)+/, "");
                if (range.endContainer instanceof Text)
                    pre = pre.replace(/(?:<\/[^>"]+>)+$/, "");
            }
        }

        line = 1 + pre.replace(/[^\n]/g, "").length;
        column = 1 + pre.replace(/[^]*\n/, "").length;

        let origGroup = textBox && textBox.getAttributeNS(NS, "highlight") || "";
        let cleanup = util.yieldable(function cleanup(error) {
            if (timer)
                timer.cancel();

            let blink = ["EditorBlink1", "EditorBlink2"];
            if (error) {
                dactyl.reportError(error, true);
                blink[1] = "EditorError";
            }
            else
                dactyl.trapErrors(update, null, true);

            if (tmpfile && tmpfile.exists())
                tmpfile.remove(false);

            if (textBox) {
                if (!keepFocus)
                    dactyl.focus(textBox);
                for (let group in values(blink.concat(blink, ""))) {
                    highlight.highlightNode(textBox, origGroup + " " + group);
                    yield 100;
                }
            }
        });

        function update(force) {
            if (force !== true && tmpfile.lastModifiedTime <= lastUpdate)
                return;
            lastUpdate = Date.now();

            let val = tmpfile.read();
            if (textBox) {
                textBox.value = val;

                if (false) {
                    let elem = DOM(textBox);
                    elem.attrNS(NS, "modifiable", true)
                        .style.MozUserInput;
                    elem.input().attrNS(NS, "modifiable", null);
                }
            }
            else {
                while (editor_.rootElement.firstChild)
                    editor_.rootElement.removeChild(editor_.rootElement.firstChild);
                editor_.rootElement.innerHTML = val;
            }
        }

        try {
            var tmpfile = io.createTempFile();
            if (!tmpfile)
                throw Error(_("io.cantCreateTempFile"));

            if (textBox) {
                highlight.highlightNode(textBox, origGroup + " EditorEditing");
                if (!keepFocus)
                    textBox.blur();
            }

            if (!tmpfile.write(text))
                throw Error(_("io.cantEncode"));

            var lastUpdate = Date.now();

            var timer = services.Timer(update, 100, services.Timer.TYPE_REPEATING_SLACK);
            this.editFileExternally({ file: tmpfile.path, line: line, column: column }, cleanup);
        }
        catch (e) {
            cleanup(e);
        }
    },

    /**
     * Expands an abbreviation in the currently active textbox.
     *
     * @param {string} mode The mode filter.
     * @see Abbreviation#expand
     */
    expandAbbreviation: function (mode) {
        let elem = this.element;
        if (!DOM(elem).isInput && elem.value)
            return;

        let text   = elem.value;
        let start  = elem.selectionStart;
        let end    = elem.selectionEnd;
        let abbrev = abbreviations.match(mode, text.substring(0, start).replace(/.*\s/g, ""));
        if (abbrev) {
            let len = abbrev.lhs.length;
            let rhs = abbrev.expand(elem);
            elem.value = text.substring(0, start - len) + rhs + text.substring(start);
            elem.selectionStart = start - len + rhs.length;
            elem.selectionEnd   = end   - len + rhs.length;
        }
    },
}, {
    TextsIterator: Class("TextsIterator", {
        init: function init(root, context) {
            this.context = context;
            this.root = root;
        },

        prevNode: function prevNode() {
            if (this.context == this.root)
                return null;

            var node = this.context.previousSibling;
            if (!node)
                node = this.context.parentNode;
            else
                while (node.lastChild)
                    node = node.lastChild;
            return this.context = node;
        },

        nextNode: function nextNode() {
            var node = this.context.firstChild;
            if (!node) {
                node = this.context;
                while (node != this.root && !node.nextSibling)
                    node = node.parentNode;

                node = node.nextSibling;
            }
            if (node == this.root || node == null)
                return null;
            return this.context = node;
        },

        getPrev: function getPrev() {
            return this.filter("prevNode");
        },

        getNext: function getNext() {
            return this.filter("nextNode");
        },

        filter: function filter(meth) {
            let node;
            while (node = this[meth]())
                if (node instanceof Ci.nsIDOMText &&
                        let ({ style } = DOM(node))
                            style.MozUserSelect != "none" &&
                            style.visibility != "hidden" &&
                            style.visibility != "collapse" &&
                            style.display != "none")
                    return node;
        }
    }),

    extendRange: function extendRange(range, forward, re, sameWord, root) {
        function advance(positive) {
            while (true) {
                while (idx == text.length && (node = iterator.getNext())) {
                    offset = text.length;
                    text += node.textContent;
                    range.setEnd(node, 0);
                }

                if (idx >= text.length || re.test(text[idx]) != positive)
                    break;
                range.setEnd(range.endContainer, ++idx - offset);
            }
        }
        function retreat(positive) {
            while (true) {
                while (idx == 0 && (node = iterator.getPrev())) {
                    let str = node.textContent;
                    idx += str.length;
                    text = str + text;
                    range.setStart(node, str.length);
                }
                if (idx == 0 || re.test(text[idx - 1]) != positive)
                    break;
                range.setStart(range.startContainer, --idx);
            }
        }

        let node = range[forward ? "endContainer" : "startContainer"];
        let iterator = Editor.TextsIterator(root || node.ownerDocument.documentElement,
                                            node);

        if (!(node instanceof Ci.nsIDOMText)) {
            node = iterator[forward ? "getNext" : "getPrev"]();
            range[forward ? "setEnd" : "setStart"](node, forward ? 0 : node.textContent.length);
        }


        let text = range[forward ? "endContainer" : "startContainer"].textContent;
        let idx  = range[forward ? "endOffset" : "startOffset"];
        let offset = 0;

        if (forward) {
            advance(true);
            if (!sameWord)
                advance(false);
        }
        else {
            if (!sameWord)
                retreat(false);
            retreat(true);
        }
        return range;
    },

    getEditor: function (elem) {
        if (arguments.length === 0) {
            dactyl.assert(dactyl.focusedElement);
            return dactyl.focusedElement;
        }

        if (!elem)
            elem = dactyl.focusedElement || document.commandDispatcher.focusedWindow;
        dactyl.assert(elem);

        return DOM(elem).editor;
    }
}, {
    mappings: function () {

        Map.types["editor"] = {
            preExecute: function preExecute(args) {
                if (editor.editor)
                    editor.editor.beginTransaction();
            },
            postExecute: function preExecute(args) {
                if (editor.editor)
                    editor.editor.endTransaction();
            },
        };
        Map.types["operator"] = {
            postExecute: function preExecute(args) {
                if (modes.main == modes.OPERATOR)
                    modes.pop();
            },
        };

        // add mappings for commands like h,j,k,l,etc. in CARET, VISUAL and TEXT_EDIT mode
        function addMovementMap(keys, description, hasCount, caretModeMethod, caretModeArg, textEditCommand, visualTextEditCommand) {
            let extraInfo = {
                count: !!hasCount,
                type: "operator"
            };

            function caretExecute(arg) {
                let win = document.commandDispatcher.focusedWindow;
                let controller = util.selectionController(win);
                let sel = controller.getSelection(controller.SELECTION_NORMAL);

                let buffer = Buffer(win);
                if (!sel.rangeCount) // Hack.
                    buffer.resetCaret();

                if (caretModeMethod == "pageMove") { // Grr.
                    buffer.scrollVertical("pages", caretModeArg ? 1 : -1);
                    buffer.resetCaret();
                }
                else
                    controller[caretModeMethod](caretModeArg, arg);
            }

            mappings.add([modes.VISUAL], keys, description,
                function ({ count }) {
                    count = count || 1;

                    let caret = !dactyl.focusedElement;
                    let controller = buffer.selectionController;

                    while (count-- && modes.main == modes.VISUAL) {
                        if (caret)
                            caretExecute(true, true);
                        else {
                            if (callable(visualTextEditCommand))
                                visualTextEditCommand(editor.editor);
                            else
                                editor.executeCommand(visualTextEditCommand);
                        }
                    }
                },
                extraInfo);

            mappings.add([modes.CARET, modes.TEXT_EDIT, modes.OPERATOR], keys, description,
                function ({ count }) {
                    count = count || 1;

                    if (editor.editor)
                        editor.executeCommand(textEditCommand, count);
                    else {
                        while (count--)
                            caretExecute(false);
                    }
                },
                extraInfo);
        }

        // add mappings for commands like i,a,s,c,etc. in TEXT_EDIT mode
        function addBeginInsertModeMap(keys, commands, description) {
            mappings.add([modes.TEXT_EDIT], keys, description || "",
                function () {
                    commands.forEach(function (cmd) { editor.executeCommand(cmd, 1) });
                    modes.push(modes.INSERT);
                },
                { type: "editor" });
        }

        function selectPreviousLine() {
            editor.executeCommand("cmd_selectLinePrevious");
            if ((modes.extended & modes.LINE) && !editor.selectedText)
                editor.executeCommand("cmd_selectLinePrevious");
        }

        function selectNextLine() {
            editor.executeCommand("cmd_selectLineNext");
            if ((modes.extended & modes.LINE) && !editor.selectedText)
                editor.executeCommand("cmd_selectLineNext");
        }

        function updateRange(editor, forward, re, modify) {
            let range = Editor.extendRange(editor.selection.getRangeAt(0),
                                           forward, re, false, editor.rootElement);
            modify(range);
            editor.selection.removeAllRanges();
            editor.selection.addRange(range);
        }

        function clear(forward, re)
            function _clear(editor) {
                updateRange(editor, forward, re, function (range) {});
                editor.selection.deleteFromDocument();
                let parent = DOM(editor.rootElement.parentNode);
                if (parent.isInput)
                    parent.input();
            }

        function move(forward, re)
            function _move(editor) {
                updateRange(editor, forward, re,
                            function (range) { range.collapse(!forward); });
            }
        function select(forward, re)
            function _select(editor) {
                updateRange(editor, forward, re,
                            function (range) {});
            }
        function beginLine(editor_) {
            editor.executeCommand("cmd_beginLine");
            move(true, /\S/)(editor_);
        }

        //             COUNT  CARET                   TEXT_EDIT            VISUAL_TEXT_EDIT
        addMovementMap(["k", "<Up>"],                 "Move up one line",
                       true,  "lineMove", false,      "cmd_linePrevious", selectPreviousLine);
        addMovementMap(["j", "<Down>", "<Return>"],   "Move down one line",
                       true,  "lineMove", true,       "cmd_lineNext",     selectNextLine);
        addMovementMap(["h", "<Left>", "<BS>"],       "Move left one character",
                       true,  "characterMove", false, "cmd_charPrevious", "cmd_selectCharPrevious");
        addMovementMap(["l", "<Right>", "<Space>"],   "Move right one character",
                       true,  "characterMove", true,  "cmd_charNext",     "cmd_selectCharNext");
        addMovementMap(["b", "<C-Left>"],             "Move left one word",
                       true,  "wordMove", false,      move(false,  /\w/), select(false, /\w/));
        addMovementMap(["w", "<C-Right>"],            "Move right one word",
                       true,  "wordMove", true,       move(true,  /\w/),  select(true, /\w/));
        addMovementMap(["B"],                         "Move left to the previous white space",
                       true,  "wordMove", false,      move(false, /\S/),  select(false, /\S/));
        addMovementMap(["W"],                         "Move right to just beyond the next white space",
                       true,  "wordMove", true,       move(true,  /\S/),  select(true,  /\S/));
        addMovementMap(["e"],                         "Move to the end of the current word",
                       true,  "wordMove", true,       move(true,  /\W/),  select(true,  /\W/));
        addMovementMap(["E"],                         "Move right to the next white space",
                       true,  "wordMove", true,       move(true,  /\s/),  select(true,  /\s/));
        addMovementMap(["<C-f>", "<PageDown>"],       "Move down one page",
                       true,  "pageMove", true,       "cmd_movePageDown", "cmd_selectNextPage");
        addMovementMap(["<C-b>", "<PageUp>"],         "Move up one page",
                       true,  "pageMove", false,      "cmd_movePageUp",   "cmd_selectPreviousPage");
        addMovementMap(["gg", "<C-Home>"],            "Move to the start of text",
                       false, "completeMove", false,  "cmd_moveTop",      "cmd_selectTop");
        addMovementMap(["G", "<C-End>"],              "Move to the end of text",
                       false, "completeMove", true,   "cmd_moveBottom",   "cmd_selectBottom");
        addMovementMap(["0", "<Home>"],               "Move to the beginning of the line",
                       false, "intraLineMove", false, "cmd_beginLine",    "cmd_selectBeginLine");
        addMovementMap(["^"],                         "Move to the first non-whitespace character of the line",
                       false, "intraLineMove", false, beginLine,          "cmd_selectBeginLine");
        addMovementMap(["$", "<End>"],                "Move to the end of the current line",
                       false, "intraLineMove", true,  "cmd_endLine" ,     "cmd_selectEndLine");

        addBeginInsertModeMap(["i", "<Insert>"], [], "Insert text before the cursor");
        addBeginInsertModeMap(["a"],             ["cmd_charNext"], "Append text after the cursor");
        addBeginInsertModeMap(["I"],             ["cmd_beginLine"], "Insert text at the beginning of the line");
        addBeginInsertModeMap(["A"],             ["cmd_endLine"], "Append text at the end of the line");
        addBeginInsertModeMap(["s"],             ["cmd_deleteCharForward"], "Delete the character in front of the cursor and start insert");
        addBeginInsertModeMap(["S"],             ["cmd_deleteToEndOfLine", "cmd_deleteToBeginningOfLine"], "Delete the current line and start insert");
        addBeginInsertModeMap(["C"],             ["cmd_deleteToEndOfLine"], "Delete from the cursor to the end of the line and start insert");

        function addMotionMap(key, desc, select, cmd, mode) {
            mappings.add([modes.TEXT_EDIT], [key],
                desc,
                function ({ count,  motion }) {
                    modes.push(modes.OPERATOR, null, {
                        count: count,

                        leave: function leave(stack) {
                            if (stack.push || stack.fromEscape)
                                return;

                            try {
                                editor_.beginTransaction();

                                let range = RangeFind.union(start, sel.getRangeAt(0));
                                sel.removeAllRanges();
                                sel.addRange(select ? range : start);
                                cmd(editor_, range);
                            }
                            finally {
                                editor_.endTransaction();
                            }

                            modes.delay(function () {
                                if (mode)
                                    modes.push(mode);
                            });
                        }
                    });

                    let editor_ = editor.editor;
                    let sel     = editor.selection;
                    let start   = sel.getRangeAt(0).cloneRange();
                },
                { count: true, type: "motion" });
        }

        addMotionMap("d", "Delete motion", true,  function (editor) { editor.cut(); });
        addMotionMap("c", "Change motion", true,  function (editor) { editor.cut(); }, modes.INSERT);
        addMotionMap("y", "Yank motion",   false, function (editor, range) { dactyl.clipboardWrite(DOM.stringify(range)) });

        let bind = function bind(names, description, action, params)
            mappings.add([modes.INPUT], names, description,
                         action, update({ type: "editor" }, params));

        bind(["<C-w>"], "Delete previous word",
             function () {
                 if (editor.editor)
                     clear(false, /\w/)(editor.editor);
                 else
                     editor.executeCommand("cmd_deleteWordBackward", 1);
             });

        bind(["<C-u>"], "Delete until beginning of current line",
             function () {
                 // Deletes the whole line. What the hell.
                 // editor.executeCommand("cmd_deleteToBeginningOfLine", 1);

                 editor.executeCommand("cmd_selectBeginLine", 1);
                 if (editor.selection && editor.selection.isCollapsed) {
                     editor.executeCommand("cmd_deleteCharBackward", 1);
                     editor.executeCommand("cmd_selectBeginLine", 1);
                 }

                 if (editor.getController("cmd_delete").isCommandEnabled("cmd_delete"))
                     editor.executeCommand("cmd_delete", 1);
             });

        bind(["<C-k>"], "Delete until end of current line",
             function () { editor.executeCommand("cmd_deleteToEndOfLine", 1); });

        bind(["<C-a>"], "Move cursor to beginning of current line",
             function () { editor.executeCommand("cmd_beginLine", 1); });

        bind(["<C-e>"], "Move cursor to end of current line",
             function () { editor.executeCommand("cmd_endLine", 1); });

        bind(["<C-h>"], "Delete character to the left",
             function () { events.feedkeys("<BS>", true); });

        bind(["<C-d>"], "Delete character to the right",
             function () { editor.executeCommand("cmd_deleteCharForward", 1); });

        bind(["<S-Insert>"], "Insert clipboard/selection",
             function () { editor.pasteClipboard(); });

        mappings.add([modes.INPUT],
           ["<C-i>"], "Edit text field with an external editor",
           function () { editor.editFieldExternally(); });

        bind(["<C-t>"], "Edit text field in Text Edit mode",
             function () {
                 dactyl.assert(!editor.isTextEdit && editor.editor);
                 dactyl.assert(dactyl.focusedElement ||
                               // Sites like Google like to use a
                               // hidden, editable window for keyboard
                               // focus and use their own WYSIWYG editor
                               // implementations for the visible area,
                               // which we can't handle.
                               let (f = document.commandDispatcher.focusedWindow.frameElement)
                                    f && Hints.isVisible(f, true));

                 modes.push(modes.TEXT_EDIT);
             });

        // Ugh.
        mappings.add([modes.INPUT, modes.CARET],
            ["<*-CR>", "<*-BS>", "<*-Del>", "<*-Left>", "<*-Right>", "<*-Up>", "<*-Down>",
             "<*-Home>", "<*-End>", "<*-PageUp>", "<*-PageDown>",
             "<M-c>", "<M-v>", "<*-Tab>"],
            "Handled by " + config.host,
            function () Events.PASS_THROUGH);

        mappings.add([modes.INSERT],
            ["<Space>", "<Return>"], "Expand Insert mode abbreviation",
            function () {
                editor.expandAbbreviation(modes.INSERT);
                return Events.PASS_THROUGH;
            });

        mappings.add([modes.INSERT],
            ["<C-]>", "<C-5>"], "Expand Insert mode abbreviation",
            function () { editor.expandAbbreviation(modes.INSERT); });

        let bind = function bind(names, description, action, params)
            mappings.add([modes.TEXT_EDIT], names, description,
                         action, update({ type: "editor" }, params));

        // text edit mode
        mappings.add([modes.TEXT_EDIT],
            ["u"], "Undo changes",
            function (args) {
                editor.executeCommand("cmd_undo", Math.max(args.count, 1));
                editor.deselectText();
            },
            { count: true });

        mappings.add([modes.TEXT_EDIT],
            ["<C-r>"], "Redo undone changes",
            function (args) {
                editor.executeCommand("cmd_redo", Math.max(args.count, 1));
                editor.deselectText();
            },
            { count: true });

        bind(["D"], "Delete characters from the cursor to the end of the line",
             function () { editor.executeCommand("cmd_deleteToEndOfLine"); });

        mappings.add([modes.TEXT_EDIT],
            ["o"], "Open line below current",
            function () {
                editor.executeCommand("cmd_endLine", 1);
                modes.push(modes.INSERT);
                events.feedkeys("<Return>");
            });

        mappings.add([modes.TEXT_EDIT],
            ["O"], "Open line above current",
            function () {
                editor.executeCommand("cmd_beginLine", 1);
                modes.push(modes.INSERT);
                events.feedkeys("<Return>");
                editor.executeCommand("cmd_linePrevious", 1);
            });

        bind(["X"], "Delete character to the left",
             function (args) { editor.executeCommand("cmd_deleteCharBackward", Math.max(args.count, 1)); },
            { count: true });

        bind(["x"], "Delete character to the right",
             function (args) { editor.executeCommand("cmd_deleteCharForward", Math.max(args.count, 1)); },
            { count: true });

        // visual mode
        mappings.add([modes.CARET, modes.TEXT_EDIT],
            ["v"], "Start Visual mode",
            function () { modes.push(modes.VISUAL); });

        mappings.add([modes.VISUAL],
            ["v", "V"], "End Visual mode",
            function () { modes.pop(); });

        mappings.add([modes.TEXT_EDIT],
            ["V"], "Start Visual Line mode",
            function () {
                modes.push(modes.VISUAL, modes.LINE);
                editor.executeCommand("cmd_beginLine", 1);
                editor.executeCommand("cmd_selectLineNext", 1);
            });

        mappings.add([modes.VISUAL],
            ["c", "s"], "Change selected text",
            function () {
                dactyl.assert(editor.isTextEdit);
                editor.executeCommand("cmd_cut");
                modes.push(modes.INSERT);
            });

        mappings.add([modes.VISUAL],
            ["d", "x"], "Delete selected text",
            function () {
                dactyl.assert(editor.isTextEdit);
                editor.executeCommand("cmd_cut");
            });

        mappings.add([modes.VISUAL],
            ["y"], "Yank selected text",
            function () {
                if (editor.isTextEdit) {
                    editor.executeCommand("cmd_copy");
                    modes.pop();
                }
                else
                    dactyl.clipboardWrite(buffer.currentWord, true);
            });

        bind(["p"], "Paste clipboard contents",
             function ({ count }) {
                dactyl.assert(!editor.isCaret);
                editor.executeCommand("cmd_paste", count || 1);
                modes.pop(modes.TEXT_EDIT);
            },
            { count: true });

        let bind = function bind(names, description, action, params)
            mappings.add([modes.TEXT_EDIT, modes.OPERATOR, modes.VISUAL],
                         names, description,
                         action, update({ type: "editor" }, params));

        // finding characters
        function offset(backward, before, pos) {
            if (!backward && modes.main != modes.TEXT_EDIT)
                pos += 1;
            if (before)
                pos += backward ? +1 : -1;
            return pos;
        }

        bind(["f"], "Find a character on the current line, forwards",
             function ({ arg, count }) {
                 let pos = editor.findChar(arg, Math.max(count, 1));
                 if (pos >= 0)
                     editor.moveToPosition(offset(false, false, pos),
                                           modes.main == modes.VISUAL);
             },
             { arg: true, count: true, type: "operator" });

        bind(["F"], "Find a character on the current line, backwards",
             function ({ arg, count }) {
                 let pos = editor.findChar(arg, Math.max(count, 1), true);
                 if (pos >= 0)
                     editor.moveToPosition(offset(true, false, pos),
                                           modes.main == modes.VISUAL);
             },
             { arg: true, count: true, type: "operator" });

        bind(["t"], "Find a character on the current line, forwards, and move to the character before it",
             function ({ arg, count }) {
                 let pos = editor.findChar(arg, Math.max(count, 1));
                 if (pos >= 0)
                     editor.moveToPosition(offset(false, true, pos),
                                           modes.main == modes.VISUAL);
             },
             { arg: true, count: true, type: "operator" });

        bind(["T"], "Find a character on the current line, backwards, and move to the character after it",
             function ({ arg, count }) {
                 let pos = editor.findChar(arg, Math.max(count, 1), true);
                 if (pos >= 0)
                     editor.moveToPosition(offset(true, true, pos),
                                           modes.main == modes.VISUAL);
             },
             { arg: true, count: true, type: "operator" });

        function mungeRange(range, munger) {
            let text = munger(range);
            let { startOffset, endOffset } = range;
            let root = range.startContainer.parentNode;

            range.deleteContents();
            range.insertNode(range.startContainer.ownerDocument
                                  .createTextNode(text));
            root.normalize();
            range.setStart(root.firstChild, startOffset);
            range.setEnd(root.firstChild, endOffset);
        }

        // text edit and visual mode
        mappings.add([modes.TEXT_EDIT, modes.VISUAL],
            ["~"], "Switch case of the character under the cursor and move the cursor to the right",
            function ({ count }) {
                function munger(range)
                    String(range).replace(/./g, function (c) {
                        let lc = c.toLocaleLowerCase();
                        return c == lc ? c.toLocaleUpperCase() : lc;
                    });

                var range = editor.selection.getRangeAt(0);
                // Ugh. TODO: Utility.
                if (!(range.startContainer instanceof Ci.nsIDOMText)) {
                    range = RangeFind.nodeContants(node.startContainer);
                    range.collapse(false);
                }

                if (range.collapsed) {
                    count = count || 1;

                    range.setEnd(range.startContainer,
                                 range.startOffset + count);
                }
                mungeRange(range, munger);
                editor.selection.collapse(range.startContainer, range.endOffset);

                modes.pop(modes.TEXT_EDIT);
            },
            { count: true });

        let bind = function bind() mappings.add.apply(mappings,
                                                      [[modes.AUTOCOMPLETE]].concat(Array.slice(arguments)))

        bind(["<Esc>"], "Return to Insert mode",
             function () Events.PASS_THROUGH);

        bind(["<C-[>"], "Return to Insert mode",
             function () { events.feedkeys("<Esc>", { skipmap: true }); });

        bind(["<Up>"], "Select the previous autocomplete result",
             function () Events.PASS_THROUGH);

        bind(["<C-p>"], "Select the previous autocomplete result",
             function () { events.feedkeys("<Up>", { skipmap: true }); });

        bind(["<Down>"], "Select the next autocomplete result",
             function () Events.PASS_THROUGH);

        bind(["<C-n>"], "Select the next autocomplete result",
             function () { events.feedkeys("<Down>", { skipmap: true }); });
    },

    options: function () {
        options.add(["editor"],
            "The external text editor",
            "string", 'gvim -f +<line> +"sil! call cursor(0, <column>)" <file>', {
                format: function (obj, value) {
                    let args = commands.parseArgs(value || this.value, { argCount: "*", allowUnknownOptions: true })
                                       .map(util.compileMacro).filter(function (fmt) fmt.valid(obj))
                                       .map(function (fmt) fmt(obj));
                    if (obj["file"] && !this.has("file"))
                        args.push(obj["file"]);
                    return args;
                },
                has: function (key) Set.has(util.compileMacro(this.value).seen, key),
                validator: function (value) {
                    this.format({}, value);
                    return Object.keys(util.compileMacro(value).seen).every(function (k) ["column", "file", "line"].indexOf(k) >= 0);
                }
            });

        options.add(["insertmode", "im"],
            "Enter Insert mode rather than Text Edit mode when focusing text areas",
            "boolean", true);

        options.add(["spelllang", "spl"],
            "The language used by the spell checker",
            "string", config.locale,
            {
                initValue: function () {},
                getter: function getter() {
                    try {
                        return services.spell.dictionary || "";
                    }
                    catch (e) {
                        return "";
                    }
                },
                setter: function setter(val) { services.spell.dictionary = val; },
                completer: function completer(context) {
                    let res = {};
                    services.spell.getDictionaryList(res, {});
                    context.completions = res.value;
                    context.keys = { text: util.identity, description: util.identity };
                }
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
