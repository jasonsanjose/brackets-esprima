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
/*global define, require, $, self, importScripts, acorn */
importScripts("thirdparty/acorn/acorn.js");

(function () {
    'use strict';
    
    function _getIdentifier(node) {
        return (node.name) ? node : node.id;
    }
    
    function _addToScope(node, id, collection) {
        collection[id.name] = node;
    }
    
    function _addIdentifier(scope, node, id) {
        id = id || _getIdentifier(node);
        
        if (id) {
            scope.identifiers = scope.identifiers || {};
            _addToScope(node, id, scope.identifiers);
        }
    }
    
    function _addDeclaration(scope, node) {
        var id = _getIdentifier(node);
        
        if (id) {
            scope.declarations = scope.declarations || {};
            _addToScope(node, id, scope.declarations);
            _addIdentifier(scope, node, id);
        }
    }
    
    function _addToQueue(queue, method, children) {
        if (!children) {
            return;
        }
        
        if (!Array.isArray(children)) {
            method.call(queue, children);
        } else {
            method.apply(queue, children);
        }
    }
    
    function _unshiftQueue(queue, children) {
        _addToQueue(queue, Array.prototype.unshift, children);
    }
    
    function _pushQueue(queue, children) {
        _addToQueue(queue, Array.prototype.push, children);
    }
    
    function _createNewScope(node, parentScope) {
        var scope = {
            parent: parentScope,
            node: node,
            identifiers: {},
            type: "scope",
            children: []
        };
        
        if (parentScope) {
            parentScope.children.push(scope);
        }
        
        return scope;
    }
    
    function _addDeclarations(scope, collection) {
        var i;
        
        for (i = 0; i < collection.length; i++) {
            _addDeclaration(scope, collection[i]);
        }
    }
    
    /**
     * Walk the syntax tree looking for scopes (closures). Returns a tree of 
     * scopes including declared and undeclared indentifiers.
     * @param {object} program
     */
    function _buildScopeInfo(program) {
        var current,
            queue = [program],
            type,
            scope = _createNewScope(program),
            blockScope,
            root = scope;
        
        while (queue.length > 0) {
            current = queue.shift();
            type = current.type;
            
            // TODO handle more expressions correctly!
            if (type === "scope") {
                scope = current;
            } else if (type === acorn.Syntax.FunctionDeclaration
                    || type === acorn.Syntax.FunctionExpression) {
                // add function decl to parent scope
                _addDeclaration(scope, current);
                
                // create a brand new scope for this closure
                blockScope = _createNewScope(current, scope);
                _pushQueue(queue, blockScope);
                
                // add params to function decl scope
                _addDeclarations(blockScope, current.params);
                
                // add body
                _pushQueue(queue, current.body);
            } else if (type === acorn.Syntax.VariableDeclaration) {
                _addDeclarations(scope, current.declarations);
            } else if (type === acorn.Syntax.ExpressionStatement) {
                _unshiftQueue(queue, current.expression);
            } else if (type === acorn.Syntax.CallExpression) {
                _unshiftQueue(queue, current.callee);
                _unshiftQueue(queue, current["arguments"]);
            } else if (type === acorn.Syntax.IfStatement) {
                _unshiftQueue(queue, current.consequent);
                
                if (current.alternate) {
                    _unshiftQueue(queue, current.alternate);
                }
            } else if (current.body) {
                _unshiftQueue(queue, current.body);
            } else {
                _addIdentifier(scope, current);
            }
        }
        
        return root;
    }

    function _parse(text, pos) {
        var syntax;
        
        try {
            syntax = acorn.parse(text, {
                locations       : true,
                ranges          : true,
                trackComments   : true
            });
        } catch (err) {
            // do nothing
            return {};
        }
        
        return {syntax: syntax, scope: _buildScopeInfo(syntax) };
    }
    
    self.addEventListener("message", function (e) {
        var type = e.data.type;
        
        if (type === "parse") {
            var result = _parse(e.data.text, e.data.pos);
            
            if (result && result.syntax) {
                self.postMessage({
                    type        : type,
                    fullPath    : e.data.fullPath,
                    syntax      : result.syntax,
                    scope       : result.scope
                });
            }
        } else {
            self.postMessage({
                log : "Unknown message: " + JSON.stringify(e.data)
            });
        }
    });
}());