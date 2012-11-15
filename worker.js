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
/*global define, require, $, self, importScripts, esprima */
importScripts("thirdparty/esprima/esprima.js");

(function () {
    'use strict';
    
    
    function _addIdentifier(scope, node) {
        var id = (node.name) ? node : node.id;
        
        if (id) {
            scope.identifiers = scope.identifiers || {};
            scope.identifiers[id.name] = node;
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
            childScope,
            root = scope;
        
        while (queue.length > 0) {
            current = queue.shift();
            type = current.type;
            
            // TODO handle more expressions correctly!
            if (type === "scope") {
                scope = current;
            } else if (type === esprima.Syntax.FunctionDeclaration
                    || type === esprima.Syntax.FunctionExpression) {
                // add function decl to parent scope
                _addIdentifier(scope, current);
                
                // create a brand new scope for this closure
                queue.push(_createNewScope(current, scope));
                
                // add params to function decl scope
                _pushQueue(queue, current.params);
                
                // add body
                _pushQueue(queue, current.body);
            } else if (type === esprima.Syntax.VariableDeclaration) {
                _unshiftQueue(queue, current.declarations);
            } else if (type === esprima.Syntax.Identifier) {
                _addIdentifier(scope, current);
            } else if (type === esprima.Syntax.ExpressionStatement) {
                _unshiftQueue(queue, current.expression);
            } else if (type === esprima.Syntax.CallExpression) {
                _unshiftQueue(queue, current.callee);
                _unshiftQueue(queue, current["arguments"]);
            } else if (type === esprima.Syntax.IfStatement) {
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
            syntax = esprima.parse(text, {
                loc         : true,
                range       : true,
                tokens      : true,
                tolerant    : true,
                comment     : true
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