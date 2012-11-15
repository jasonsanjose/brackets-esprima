define(function () {
    function myFunction(arg) {
        var foo, bar = 1;
    }
});

function sayHello(str) {
    sayWorld();
}

function clear(z) {
    if (z) {
        var hoist1;
    } else if (!z) {
        var hoist2; 
    } else {
        var hoist3; 
    }
}

var outer;
(function (x) {
    var inner;
}());