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
    
    var EditorManager = brackets.getModule("editor/EditorManager");
    
    var path    = module.uri.substring(0, module.uri.lastIndexOf("/") + 1),
        worker  = new Worker(path + "worker.js");
    
    function _parseEditor(editor) {
        worker.postMessage({
            type    : "parse",
            text    : editor.document.getText()
        });
    }
    
    function _installEditorListeners(editor) {
        if (!editor) {
            return;
        }
        
        $(editor).on("change.brackets-esprima", function () {
            _parseEditor(editor);
        });
        _parseEditor(editor);
    }
    
    function _activeEditorChange(event, current, previous) {
        if (previous) {
            $(previous.document).off(".brackets-esprima");
        }
        
        _installEditorListeners(current);
    }
    
    // init
    (function () {
        worker.addEventListener("message", function (e) {
            var type = e.data.type;
            
            if (type === "parse") {
                console.log(e.data.tree);
            } else {
                console.log(e.data.log || e.data);
            }
        });
        
        // start the worker
        worker.postMessage({});
        
        $(EditorManager).on("activeEditorChange", _activeEditorChange);
        _installEditorListeners(EditorManager.getFocusedEditor());
    }());
});