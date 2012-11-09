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
            scope.identifiers[id.name] = node;
        }
    }
    
    function _processIdentifiers(body, scope) {
        var nodes = Array.isArray(body) ? body : [body],
            type;
        
        scope.identifiers = scope.identifiers || {};
        
        nodes.forEach(function (current) {
            type = current.type;
            
            // TODO handle more expressions correctly!
            if (type === esprima.Syntax.FunctionDeclaration
                    || type === esprima.Syntax.FunctionExpression) {
                // add pointer to parent scope
                current.parentScope = scope;
                
                // add function decl to parent scope
                _addIdentifier(current.parentScope, current);
                
                // add params to function decl scope
                _processIdentifiers(current.params, current);
                
                // create a new scope for this function
                _processIdentifiers(current.body, current);
            } else if (type === esprima.Syntax.VariableDeclaration) {
                _processIdentifiers(current.declarations, scope);
            } else if (type === esprima.Syntax.Identifier) {
                _addIdentifier(scope, current);
            } else if (type === esprima.Syntax.ExpressionStatement) {
                _processIdentifiers(current.expression, scope);
            } else if (type === esprima.Syntax.CallExpression) {
                _processIdentifiers(current.callee, scope);
                _processIdentifiers(current["arguments"], scope);
            } else if (type === esprima.Syntax.IfStatement) {
                _processIdentifiers(current.consequent, scope);
                
                if (current.alternate) {
                    _processIdentifiers(current.alternate, scope);
                }
            } else if (current.body) {
                _processIdentifiers(current.body, scope);
            } else {
                _addIdentifier(scope, current);
            }
        });
    }

    function _parse(text) {
        var syntax,
            currentBody;
        
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
            return null;
        }
        
        _processIdentifiers(syntax.body, syntax);
        
        return syntax;
    }
    
    self.addEventListener("message", function (e) {
        var type = e.data.type;
        
        if (type === "parse") {
            var syntax = _parse(e.data.text);
            
            if (syntax) {
                self.postMessage({
                    type        : type,
                    fullPath    : e.data.fullPath,
                    syntax      : syntax
                });
            }
        } else {
            self.postMessage({
                log : "Unknown message: " + JSON.stringify(e.data)
            });
        }
    });
}());