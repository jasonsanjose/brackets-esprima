/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Worker */

define(function (require, exports, module) {
    'use strict';
    
    require("thirdparty/jquery-throttle-debounce/jquery.ba-throttle-debounce");
    
    var acorn               = require("thirdparty/acorn/acorn"),
        CodeHintsManager    = brackets.getModule("editor/CodeHintManager"),
        EditorManager       = brackets.getModule("editor/EditorManager"),
        ExtensionUtils      = brackets.getModule("utils/ExtensionUtils"),
        CommandManager      = brackets.getModule("command/CommandManager"),
        Menus               = brackets.getModule("command/Menus"),
        Strings             = brackets.getModule("strings");
    
    ExtensionUtils.loadStyleSheet(module, "styles/styles.css");
    
    var PARSER_COMMAND_ID   = "brackets-esprima",
        PARSER_COMMAND_STR  = "Enable JavaScript Parser",
        path                = module.uri.substring(0, module.uri.lastIndexOf("/") + 1),
        worker,
        parseInfo,
        markers             = [],
        enabled             = true;
    
    function _parseEditor(editor) {
        // TODO handle async issues if parsing completes after switching editors
        // TODO move marker creation to worker thread?
        worker.postMessage({
            type        : "parse",
            fullPath    : editor.document.file.fullPath,
            text        : editor.document.getText(),
            pos         : editor.indexFromPos(editor.getCursorPos(false))
        });
    }
    
    function _clearMarkers() {
        if (markers.length === 0) {
            return;
        }
        
        markers.forEach(function (marker) {
            marker.clear();
        });
        
        markers = [];
    }
    
    // Executes visitor on the object and its children (recursively).
    function traverse(object, visitor, master) {
        var key, child, parent, path;

        parent = (typeof master === 'undefined') ? [] : master;

        if (visitor.call(null, object, parent) === false) {
            return false;
        }
        
        for (key in object) {
            if (object.hasOwnProperty(key)) {
                child = object[key];
                path = [ object ];
                path.push(parent);
                if (typeof child === "object" && child !== null) {
                    if (traverse(child, visitor, path) === false) {
                        // stop traversal
                        return false;
                    }
                }
            }
        }
        
        return true;
    }
    
    /**
     * Returns the scope for the identifier's declaration. 
     */
    function _getScopeForIdentifier(scope, index, id) {
        var result,
            queue = [scope],
            current,
            node;
        
        while (queue.length) {
            current = queue.shift();
            node = current.node;
            
            if (node.range && node.range[0] <= index && index < node.range[1]) {
                queue = [].concat(current.children);
                
                if (current.declarations && current.declarations[id.name]) {
                    // found a matching variable name declaration
                    result = current;
                }
            }
        }
        
        return result;
    }
    
    // modified from http://esprima.org/demo/highlight.html
    function trackCursor(editor) {
        var pos, node, id;
        
        _clearMarkers();
    
        // AST will be null if there are unrecoverable errors
        if (parseInfo.syntax === null) {
            return;
        }
    
        pos = editor.indexFromPos(editor.getCursor());
    
        // highlight the identifier under the cursor
        traverse(parseInfo.syntax, function (node, path) {
            var start, end;
            
            if (node.type !== acorn.Syntax.Identifier) {
                return true;
            }
            
            if (pos >= node.range[0] && pos <= node.range[1]) {
                start = {
                    line: node.loc.start.line - 1,
                    ch: node.loc.start.column
                };
                end = {
                    line: node.loc.end.line - 1,
                    ch: node.loc.end.column
                };
                markers.push(editor.markText(start, end, 'identifier'));
                id = node;
                
                return false;
            }
            
            return true;
        });
    
        // highlight all occurrences of the identifier
        if (!id) {
            return;
        }
        
        var cursorScope = _getScopeForIdentifier(parseInfo.scope, pos, id),
            nodeScope,
            matchName,
            inRange;
        
        traverse(parseInfo.syntax, function (node, path) {
            var start, end;
            
            if (node.type !== acorn.Syntax.Identifier) {
                return true;
            }
            
            // match the identifier token
            matchName = id && node !== id && node.name === id.name;
            
            // verify the node is inside the declaring scope's range
            inRange = matchName && node.range[0] >= cursorScope.node.range[0] && node.range[1] <= cursorScope.node.range[1];
            
            // make sure the current node is not in a descendant scope that
            // declares the same variable name
            nodeScope = inRange ? _getScopeForIdentifier(cursorScope, node.range[0], id) : null;
            
            if (inRange && cursorScope === nodeScope) {
                start = {
                    line: node.loc.start.line - 1,
                    ch: node.loc.start.column
                };
                end = {
                    line: node.loc.end.line - 1,
                    ch: node.loc.end.column
                };
                markers.push(editor.markText(start, end, 'highlight'));
            }
            
            return true;
        });
    }
    
    function _markOccurrences(editor) {
        // TODO handle async issues if parsing completes after switching editors
        trackCursor(editor._codeMirror);
    }
    
    function _installEditorListeners(editor) {
        if (!editor) {
            return;
        }
        
        // debounce parse and mark occurrences so that both handlers wait 100ms
        // for their respective events to finish
        var debounceParse = $.debounce(100, function () {
            _parseEditor(editor);
        });
        
        var debounceMarkOccurrences = $.debounce(200, function () {
            _markOccurrences(editor);
        });
        
        $(editor)
            .on("change.brackets-esprima", _clearMarkers)
            .on("change.brackets-esprima", debounceParse)
            .on("cursorActivity.brackets-esprima", debounceMarkOccurrences);
        
        // immediately parse the new editor
        _parseEditor(editor);
    }
    
    function _uninstallEditorListeners(editor) {
        editor = editor || EditorManager.getActiveEditor();
        $(editor).off(".brackets-esprima");
    }
    
    function _activeEditorChange(event, current, previous) {
        if (previous) {
            _uninstallEditorListeners(previous);
        }
        
        _installEditorListeners(current);
    }
    
    /**
     * Returns all identifiers beginning at the top of the scope tree,
     * traversing down the branch of the tree that contains the specified
     * index.
     */
    function _getIdentifiersInScope(scope, index) {
        var identifiers = [],
            queue = [scope],
            current,
            node;
        
        while (queue.length) {
            current = queue.shift();
            node = current.node;
            
            if (node.range && node.range[0] <= index && index < node.range[1]) {
                queue = [].concat(current.children);
                
                // add immediate identifier children
                Array.prototype.push.apply(identifiers, Object.keys(current.identifiers));
            }
        }
        
        return identifiers;
    }
    
    function IdentifierHints() {
    }
    
    IdentifierHints.prototype.getQueryInfo = function (editor, cursor) {
        var query = { queryStr: "" },
            pos = editor.indexFromPos(cursor);
        
        // FIXME refine queryStr
        if (enabled && (editor.getModeForSelection() === "javascript")) {
            var token = editor._codeMirror.getTokenAt(cursor);
            
            // See if there's an identifier at the cursor location
            if (token.className) {
                query.queryStr = token.string.trim();
            }
        
            query.identifiers = _getIdentifiersInScope(parseInfo.scope, pos);
        }
        
        return query;
    };
    
    IdentifierHints.prototype.search = function (query) {
        var results = [],
            string = query.queryStr;
        
        // simple substring start search
        query.identifiers.forEach(function (ident) {
            if (!string || string.length === 0 || ident.indexOf(string) === 0) {
                results.push(ident);
            }
        });
        
        return results.sort(function (a, b) {
            if (a < b) {
                return -1;
            } else if (a > b) {
                return 1;
            }
            
            return 0;
        });
    };
    
    IdentifierHints.prototype.handleSelect = function (completion, editor, cursor) {
        // FIXME look at tokens behind the cursor
        editor.document.replaceRange(completion, cursor);
        
        return true;
    };
    
    IdentifierHints.prototype.shouldShowHintsOnKey = function (key) {
        return key === ".";
    };
    
    function _setParserEnabled(newEnabled) {
        var $exports = $(exports);
        
        enabled = newEnabled;
        
        CommandManager.get(PARSER_COMMAND_ID).setChecked(enabled);
        
        if (enabled) {
            worker = new Worker(path + "worker.js");
        
            worker.addEventListener("message", function (e) {
                var type = e.data.type;
                
                if (type === "parse") {
                    // only fire the parse event if the active editor matches the parsed document
                    var activeEditor = EditorManager.getActiveEditor();
                    
                    // save the current syntax tree
                    parseInfo = e.data;
                    
                    if (activeEditor && (activeEditor.document.file.fullPath === e.data.fullPath)) {
                        $(exports).triggerHandler("parse", [e.data.syntax, activeEditor]);
                    }
                } else {
                    console.log(e.data.log || e.data);
                }
            });
        
            // start the worker
            worker.postMessage({});
            
            // uninstall/install change listner as the active editor changes
            $(EditorManager).on("activeEditorChange.brackets-esprima", _activeEditorChange);
            
            // install on the initial active editor
            _installEditorListeners(EditorManager.getActiveEditor());
            
            // install our own parse event handler
            $exports.on("parse.brackets-esprima", function (event, syntax, editor) {
                _markOccurrences(editor);
            });
        } else {
            if (worker) {
                worker.terminate();
                worker = null;
            }
            
            // uninstall listeners
            _uninstallEditorListeners();
            $(EditorManager).off(".brackets-esprima");
            $exports.off(".brackets-esprima");
        }
    }
    
    function _handleToggleParser() {
        _setParserEnabled(!enabled);
    }
    
    // init
    (function () {
        // create command
        var cmd = CommandManager.register(PARSER_COMMAND_STR, PARSER_COMMAND_ID, _handleToggleParser);
        _setParserEnabled(enabled);
        
        var debugMenu = Menus.getMenu(Menus.AppMenuBar.DEBUG_MENU);
        debugMenu.addMenuItem(PARSER_COMMAND_ID);
        
        // FIXME need CodeHintsManager.unregister()
        CodeHintsManager.registerHintProvider(new IdentifierHints());
    }());
});