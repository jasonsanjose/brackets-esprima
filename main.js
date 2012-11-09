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
    
    var esprima             = require("thirdparty/esprima/esprima"),
        CodeHintsManager    = brackets.getModule("editor/CodeHintManager"),
        EditorManager       = brackets.getModule("editor/EditorManager"),
        ExtensionUtils      = brackets.getModule("utils/ExtensionUtils");
    
    ExtensionUtils.loadStyleSheet(module, "styles/styles.css");
    
    var path            = module.uri.substring(0, module.uri.lastIndexOf("/") + 1),
        worker          = new Worker(path + "worker.js"),
        syntax,
        markers         = [],
        identifiers     = {},
        cursorScope     = null;
    
    function _parseEditor(editor) {
        // TODO handle async issues if parsing completes after switching editors
        // TODO move marker creation to worker thread?
        worker.postMessage({
            type        : "parse",
            fullPath    : editor.document.file.fullPath,
            text        : editor.document.getText()
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
    
    function _findCurrentScope(current, pos, scope) {
        scope = (current.identifiers) ? current : scope;
        
        if (current.range && current.range[0] <= pos && pos <= current.range[1]) {
            if (!current.body) {
                return scope;
            } else {
                var children = Array.isArray(current.body) ? current.body : [current.body],
                    i = 0,
                    child;
                
                for (i = 0; i < children.length; i++) {
                    var foundScope = _findCurrentScope(children[i], pos, scope);
                    
                    if (foundScope) {
                        return foundScope;
                    }
                }
            }
        }
        
        return scope;
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
                if (typeof child === 'object' && child !== null) {
                    if (traverse(child, visitor, path) === false) {
                        // stop traversal
                        return false;
                    }
                }
            }
        }
        
        return true;
    }
    
    // modified from http://esprima.org/demo/highlight.html
    function trackCursor(editor) {
        var pos, code, node, id;
        
        _clearMarkers();
        
        identifiers = {};
    
        if (syntax === null) {
            return;
//            parse();
//            if (syntax === null) {
//                return;
//            }
        }
    
        pos = editor.indexFromPos(editor.getCursor());
        code = editor.getValue();
        
        cursorScope = _findCurrentScope(syntax, pos, null);
    
        // highlight the identifier under the cursor
        traverse(syntax, function (node, path) {
            var start, end;
            
            if (node.type !== esprima.Syntax.Identifier) {
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
        traverse(syntax, function (node, path) {
            var start, end;
            
            if (node.type !== esprima.Syntax.Identifier) {
                return true;
            }
            
            // log all identifiers
            identifiers[node.name] = node;
            
            if (id && node !== id && node.name === id.name) {
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
        
        var debounceMarkOccurrences = $.debounce(100, function () {
            _markOccurrences(editor);
        });
        
        $(editor)
            .on("change.brackets-esprima", _clearMarkers)
            .on("change.brackets-esprima", debounceParse)
            .on("cursorActivity.brackets-esprima", debounceMarkOccurrences);
        
        // immediately parse the new editor
        _parseEditor(editor);
    }
    
    function _activeEditorChange(event, current, previous) {
        if (previous) {
            $(previous.document).off(".brackets-esprima");
        }
        
        _installEditorListeners(current);
    }
    
    function IdentifierHints() {
    }
    
    IdentifierHints.prototype.getQueryInfo = function (editor, cursor) {
        var query = { queryStr: "" };
        
        // FIXME refine queryStr
        if (editor.getModeForSelection() === "javascript") {
            var token = editor._codeMirror.getTokenAt(cursor);
            
            // See if there's an identifier at the cursor location
            if (token.className) {
                query.queryStr = token.string.trim();
            }
        }
        
        return query;
    };
    
    IdentifierHints.prototype.search = function (query) {
        var results = [],
            string = query.queryStr,
            idents = [];
        
        // walk up the tree
        if (cursorScope) {
            var currentScope = cursorScope;
            
            do {
                Array.prototype.push.apply(idents, Object.keys(currentScope.identifiers));
                currentScope = currentScope.parentScope;
            } while (currentScope);
        } else {
            Array.prototype.push.apply(idents, Object.keys(identifiers));
        }
        
        // simple substring start search
        idents.forEach(function (ident) {
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
    
    IdentifierHints.prototype.handleSelect = function (string, editor, cursor) {
    };
    
    IdentifierHints.prototype.shouldShowHintsOnKey = function (key) {
        return key === ".";
    };
    
    function _addIdentifier(scope, node) {
        var id = (node.name) ? node : node.id;
        
        if (id) {
            scope.identifiers[id.name] = node;
        }
    }
    
    function _processIdentifiers(body, scope) {
        var nodes = Array.isArray(body) ? body : [body];
        
        scope.identifiers = scope.identifiers || {};
        
        nodes.forEach(function (current) {
            if (current.type === esprima.Syntax.FunctionDeclaration) {
                // add pointer to parent scope
                current.parentScope = scope;
                
                // add function decl to parent scope
                _addIdentifier(current.parentScope, current);
                
                // add params to function decl scope
                _processIdentifiers(current.params, current);
                
                // create a new scope for this function
                _processIdentifiers(current.body, current);
            } else if (current.type === esprima.Syntax.VariableDeclaration) {
                _processIdentifiers(current.declarations, scope);
            } else if (current.type === esprima.Syntax.Identifier) {
                _addIdentifier(scope, current);
            } else if (current.body) {
                _processIdentifiers(current.body, scope);
            } else {
                _addIdentifier(scope, current);
            }
        });
    }
    
    // init
    (function () {
        var $exports = $(exports);
        
        worker.addEventListener("message", function (e) {
            var type = e.data.type;
            
            if (type === "parse") {
                // only fire the parse event if the active editor matches the parsed document
                var activeEditor = EditorManager.getActiveEditor();
                
                // save the current syntax tree
                syntax = e.data.syntax;
                
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
        $exports.on("parse", function (event, syntax, editor) {
            _markOccurrences(editor);
            _processIdentifiers(syntax.body, syntax);
        });
        
        CodeHintsManager.registerHintProvider(new IdentifierHints());
    }());
});