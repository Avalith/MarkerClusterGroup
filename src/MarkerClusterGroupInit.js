/*
	
	
	
==== FEATURES
	
TODO: only visible in bounds
TODO: rename events
TODO: add more events
	
TD: removing/clearing stuff
TD: some refactoring ( i have found some little code duplications and stuff )
	
	
==== OPTIMIZATIONS and REFACTORING
TD: some refactoring ( i have found some little code duplications and stuff )
TODO: GE.AddListener add function(){ _this.function() } as Function.bind.apply(function, [this]) also do a shorthand for this
	
TODO: "this" should be a variable
-- TODO: array.indexOf instead of loop --
-- TODO: cache ll2px in the object --
-- MAP.DistanceGrid::getCoords to be cached in the point --


==== BUGS
TODO: zooming out when visible bounds wrap
TODO: click and drag cluster should not trigger the event
TODO: on 125K pins 50K pin does not zoom (probably check the zoom level and increase it)


==== STYLES
TODO: styles
	- spacing: ifs, fors, whiles, functions, etc,
	- braces, brackets
	- var declarations: first non-initialized, align, commas, colons
	- function names and variable names should be camleCased to comply with standards even if i do not like this
	
TODO: migrate to grunt and livescript


*/


if(typeof MAP == 'undefined'){ MAP = {}; }

MAP.TRANSITIONS = false;

MAP.stamp = function(obj)
{
	return (obj.__stamp_id = '__stamp_id' in obj ? obj.__stamp_id : ++MAP.stamp.last_id);
};
MAP.stamp.last_id = 0;

MAP.bind = function(fn, obj){ return Function.bind.apply(fn, [obj]); };

MAP.extend = function(obj1, obj2)
{
	for(var i in obj2){ obj1[i] = obj2[i]; }
	
	return obj1;
};
