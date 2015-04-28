/*



==== FEATURES

TODO: fingerprint
TODO: only visible in bounds

TD: animations eye candy
TD: removing/clearing stuff
TD: some refactoring ( i have found some little code duplications and stuff )


==== OPTIMIZATIONS and REFACTORING

TD: some refactoring ( i have found some little code duplications and stuff )
TODO: GE.AddListener add function(){ _this.function() } as Function.bind.apply(function, [this]) also do a shorthand for this

TODO: use getPosition or .position consistently
TODO: "this" should be a variable
TODO: chunked loading and progress
-- TODO: array.indexOf instead of loop --
-- TODO: cache ll2px in the object --
-- LGM.DistanceGrid::getCoords to be cached in the point --


==== BUGS
TODO: zooming out when visible bounds wrap
TODO: click and drag cluster should not trigger the event
TODO: on 125K pins 50K pin does not zoom (probably check the zoom level and increase it)


==== STYLES
TODO: styles
	- spacing: ifs, fors, whiles, functions, etc,
	- braces, brackets
	- var declarations: first non-initialized, align, commas, colons
	- function names and variable names

TODO: migrate to grunt and livescript


*/


var	GM = google.maps
,	GE = GM.event
;


ll2px = (function()
{
	// https://developers.google.com/maps/documentation/javascript/examples/map-coordinates
	var	TILE_SIZE		= 256
	,	TILE_SIZE2		= TILE_SIZE / 2
	,	px_per_lon_deg	= TILE_SIZE / 360
	,	px_per_lon_rad	= TILE_SIZE / (2 * Math.PI)
	,	px_origin		= new GM.Point(TILE_SIZE2, TILE_SIZE2)
	,	PI_180			= Math.PI / 180
	;
	
	function bound(value, opt_min, opt_max)
	{
		if(opt_min){ value = Math.max(value, opt_min); }
		if(opt_max){ value = Math.min(value, opt_max); }
		return value;
	}
	
	function deg2rad(deg){ return deg * (PI_180); }
	
	function projection(lat_lng, zoom)
	{
		var	ntiles	= 1 << zoom
		,	point	= new GM.Point(0, 0)
		;
		
		// Truncating to 0.9999 effectively limits latitude to 89.189. This is about a third of a tile past the edge of the world tile.
		var siny = bound(Math.sin(deg2rad(lat_lng.lat())), -0.9999, 0.9999);
		
		point.x = parseInt((px_origin.x + lat_lng.lng() * px_per_lon_deg) * ntiles);
		point.y = parseInt((px_origin.y + 0.5 * Math.log((1 + siny) / (1 - siny)) * -px_per_lon_rad) * ntiles);
		
		return point;
	};
	
	return function(obj, lat_lng, zoom)
	{
		if(!obj.__projection_px){ obj.__projection_px = []; }
		
		return obj.__projection_px[zoom] || (obj.__projection_px[zoom] = projection(lat_lng, zoom));
	};
}());


extend = function(obj1, obj2)
{
	for(var i in obj2){ obj1[i] = obj2[i]; }
	
	return obj1;
};


// TODO: get rid of this? or refactor it
function FeatureGroup()
{
	this.map = null;
	this.layers = [];
	this.addLayer = function(layer)
	{
		if(!this.map){ return; }
		
		this.layers.push(layer);
		// console.log(layer);
		layer.setMap(this.map);
	};
	
	this.removeLayer = function(layer)
	{
		var i = this.layers.indexOf(layer);
		
		if(i > -1){ i = this.layers.splice(i, 1)[0].setMap(null); }
	};
	
	this.eachLayer = function(cb)
	{
		// console.log(this.layers);
		for(var i = 0; i < this.layers.length; i++){ cb(this.layers[i]); }
	};
}


function MarkerClusterGroup(options)
{
	this._featureGroup = new FeatureGroup();
	
	this._needsClustering	= [];
	this._needsRemoving		= []; // TODO Do we need this
	
	this.options = extend({
		maxClusterRadius: 80,	//A cluster will cover at most this many pixels from its center
		
		zoomToBoundsOnClick: true,
		
		spiderfyOnMaxZoom: true,
		spiderfyDistanceMultiplier: 1, //Increase to increase the distance away that spiderfied markers appear from the center
		
		disableClusteringAtZoom: null,
		
		// animateAddingMarkers: false,
		
		// Setting this to false prevents the removal of any clusters outside of the viewpoint, which
		// is the default behaviour for performance reasons.
		removeOutsideVisibleBounds: true,
		
		chunkedLoading	: false,
		chunkInterval	: 200,	// process markers for a maximum of ~ n milliseconds (then trigger the chunkProgress callback)
		chunkDelay		: 1,	// at the end of each interval, give n milliseconds back to system/browser
		chunkProgress	: null,	// progress callback: function(processed, total, elapsed) (e.g. for a progress indicator)
	}, options);
	
	this._queue = [];
}

MarkerClusterGroup.prototype = new GM.OverlayView();


// ======= Google Maps Functions =======

MarkerClusterGroup.prototype.draw = function(){};

MarkerClusterGroup.prototype.onAdd = function()
{
	this._featureGroup.map = this.map;
	
	if(!this._gridClusters)
	{
		this._generateInitialClusters();
	}
	
	// for (i = 0, l = this._needsRemoving.length; i < l; i++) {
	// 	layer = this._needsRemoving[i];
	// 	this._removeLayer(layer, true);
	// }
	this._needsRemoving = [];
	
	//Remember the current zoom level and bounds
	this._zoom = this.map.getZoom();
	this._currentShownBounds = this._getExpandedVisibleBounds();
	
	//TODO: move this in spiderify.js with bind and call 
	if(this._spiderfierOnAdd){ this._spiderfierOnAdd(); }
	
	this._bindEvents();
	
	//Actually add our markers to the map:
	l = this._needsClustering;
	this._needsClustering = [];
	this.addLayers(l);
};

MarkerClusterGroup.prototype.onRemove = function(map)
{
	this._unbindEvents();
	
	//In case we are in a cluster animation
	this._map._mapPane.className = this._map._mapPane.className.replace(' leaflet-cluster-anim', '');
	
	// if (this._spiderfierOnRemove) { //TODO FIXME: Not sure how to have spiderfier add something on here nicely
	// 	this._spiderfierOnRemove();
	// }
	
	//Clean up all the layers we added to the map
	this._featureGroup.clearLayers();
};



// ======= Signle Layer Functions =======

MarkerClusterGroup.prototype.hasLayer = function(layer)
{
	// TODO Refactor this in a single return
	if(!layer){ return false; }
	
	if(layer.__parent && layer.__parent._group === this) return true;
	
	if(this._needsClustering.indexOf(layer) > -1){ return true; }
	// var i, anArray = this._needsClustering;
	// for(i = anArray.length - 1; i >= 0; i--) {
	// 	if (anArray[i] === layer) {
	// 		return true;
	// 	}
	// }
	
	if(this._needsRemoving.indexOf(layer) > -1){ return false; }
	// anArray = this._needsRemoving;
	// for (i = anArray.length - 1; i >= 0; i--) {
	// 	if (anArray[i] === layer) {
	// 		return false;
	// 	}
	// }
	
	return !!(layer.__parent && layer.__parent._group === this); // || this._nonPointGroup.hasLayer(layer);
};

MarkerClusterGroup.prototype.addLayer = function(layer)
{
	// if (layer instanceof L.LayerGroup) {
	// 	var array = [];
	// 	for (var i in layer._layers) {
	// 		array.push(layer._layers[i]);
	// 	}
	// 	return this.addLayers(array);
	// }

	//Don't cluster non point data
	// if (!layer.getLatLng) {
	// 	this._nonPointGroup.addLayer(layer);
	// 	return this;
	// }
	
	if(!this._topClusterLevel)
	{
		this._needsClustering.push(layer);
		return; // this;
	}
	
	if (this.hasLayer(layer)) {
		return this;
	}
	
	if(this._unspiderfy)
	{
		this._unspiderfy();
	}
	
	this._addLayer(layer, this._maxZoom);
	
	//Work out what is visible
	var visibleLayer = layer, currentZoom = this.map.getZoom();
	if(layer.__parent)
	{
		while(visibleLayer.__parent._zoom >= currentZoom){ visibleLayer = visibleLayer.__parent; }
	}

	if(this._currentShownBounds.contains(visibleLayer.position))
	{
		this._animationAddLayer(layer, visibleLayer);
	}
};

MarkerClusterGroup.prototype.removeLayer = function(layer)
{

	// if (layer instanceof L.LayerGroup)
	// {
	// 	var array = [];
	// 	for (var i in layer._layers) {
	// 		array.push(layer._layers[i]);
	// 	}
	// 	return this.removeLayers(array);
	// }

	//Non point layers
	// if (!layer.getLatLng) {
	// 	this._nonPointGroup.removeLayer(layer);
	// 	return this;
	// }

	// if (!this._map) {
	// 	if (!this._arraySplice(this._needsClustering, layer) && this.hasLayer(layer)) {
	// 		this._needsRemoving.push(layer);
	// 	}
	// 	return this;
	// }

	// if (!layer.__parent) {
	// 	return this;
	// }

	// if (this._unspiderfy) {
	// 	this._unspiderfy();
	// 	this._unspiderfyLayer(layer);
	// }

	// //Remove the marker from clusters
	// this._removeLayer(layer, true);

	// if (this._featureGroup.hasLayer(layer)) {
	// 	this._featureGroup.removeLayer(layer);
	// 	if (layer.setOpacity) {
	// 		layer.setOpacity(1);
	// 	}
	// }

	return this;
};



// ======= All Layers Functions =======

MarkerClusterGroup.prototype.addLayers = function(layersArray)
{
	var	newMarkers, i, l, m, markers
	,	fg				= this._featureGroup
	// 	npg = this._nonPointGroup,
	,	chunked			= this.options.chunkedLoading
	,	chunkInterval	= this.options.chunkInterval
	,	chunkProgress	= this.options.chunkProgress
	,	chunkDelay		= this.options.chunkDelay
	;
	
	if(this._topClusterLevel)
	{
		console.log('has map, layers: ' + layersArray.length);
		var offset = 0, started = (new Date()).getTime();
		
		var process = Function.bind.apply(function()
		{
			var start = (new Date()).getTime();
			
			for(; offset < layersArray.length; offset++)
			{
				if(chunked && offset % 250 === 0)
				{
					// every couple hundred markers, instrument the time elapsed since processing started:
					var elapsed = (new Date()).getTime() - start;
					if(elapsed > chunkInterval){ break; } // take a break
				}
				
				m = layersArray[offset];
				
				//Not point data, can't be clustered
				// if(!m.getPosition)
				// {
				// 	npg.addLayer(m);
				// 	continue;
				// }
				
				// console.log(this.hasLayer(m), this._needsClustering);
				if(this.hasLayer(m)){ continue; }
				
				this._addLayer(m, this._maxZoom);
				
				//If we just made a cluster of size 2 then we need to remove the other marker from the map (if it is) or we never will
				if(m.__parent && m.__parent.getChildCount() === 2)
				{
					markers		= m.__parent.getAllChildMarkers();
					fg.removeLayer(markers[0] === m ? markers[1] : markers[0]);
				}
			}
			
			if(chunkProgress){ chunkProgress(offset, layersArray.length, (new Date()).getTime() - started); }
			
			if(offset === layersArray.length)
			{
				// alert('markers loaded for' + ( (new Date).getTime() - started ) + 'ms');
				
				this._topClusterLevel._recursivelyAddChildrenToMap(null, this._zoom, this._currentShownBounds);
				
				// Update the icons of all those visible clusters that were affected
				fg.eachLayer(function(c)
				{
					if(c instanceof MarkerCluster && c._iconNeedsUpdate){ c._updateIcon(); }
				});
			}
			else
			{
				setTimeout(process, chunkDelay);
			}
		}, [this]);
		
		process();
	}
	else
	{
		console.warn('has no map');
		
		newMarkers = [];
		for(i = 0, l = layersArray.length; i < l; i++)
		{
			m = layersArray[i];
		// 	//Not point data, can't be clustered
		// 	if (!m.getLatLng) {
		// 		npg.addLayer(m);
		// 		continue;
		// 	}
			
			if(this.hasLayer(m)){ continue; }
			
			newMarkers.push(m);
		}
		
		this._needsClustering = this._needsClustering.concat(newMarkers);
	}
	return this;
};

MarkerClusterGroup.prototype.removeLayers = function(layersArray)
{
	// var i, l, m,
	// 	fg = this._featureGroup,
	// 	npg = this._nonPointGroup;

	// if (this._unspiderfy) {
	// 	this._unspiderfy();
	// }

	// if (!this._map) {
	// 	for (i = 0, l = layersArray.length; i < l; i++) {
	// 		m = layersArray[i];
	// 		this._arraySplice(this._needsClustering, m);
	// 		npg.removeLayer(m);
	// 	}
	// 	return this;
	// }

	// for (i = 0, l = layersArray.length; i < l; i++) {
	// 	m = layersArray[i];

	// 	// if (!m.__parent) {
	// 	// 	npg.removeLayer(m);
	// 	// 	continue;
	// 	// }

	// 	this._removeLayer(m, true, true);

	// 	if (fg.hasLayer(m)) {
	// 		fg.removeLayer(m);
	// 		if (m.setOpacity) {
	// 			m.setOpacity(1);
	// 		}
	// 	}
	// }

	//Fix up the clusters and markers on the map
	// this._topClusterLevel._recursivelyAddChildrenToMap(null, this._zoom, this._currentShownBounds);

	// fg.eachLayer(function (c) {
	// 	if (c instanceof MarkerCluster) {
	// 		c._updateIcon();
	// 	}
	// });

	return this;
};

MarkerClusterGroup.prototype.clearLayers = function()
{
	//If we aren't on the map (yet), blow away the markers we know of
	if (!this._map) {
		this._needsClustering = [];
		delete this._gridClusters;
		delete this._gridUnclustered;
	}
	
	if (this._noanimationUnspiderfy) {
		this._noanimationUnspiderfy();
	}
	
	//Remove all the visible layers
	this._featureGroup.clearLayers();
	// this._nonPointGroup.clearLayers();
	
	this.eachLayer(function (marker) {
		delete marker.__parent;
	});
	
	if(this._map)
	{
		//Reset _topClusterLevel and the DistanceGrids
		this._generateInitialClusters();
	}
	
	return this;
};


// ======= Special Layers Functions =======

//Zoom: Zoom to start adding at (Pass this._maxZoom to start at the bottom)
MarkerClusterGroup.prototype._addLayer = function (layer, zoom)
{
	var	markerPoint, z
	,	gridClusters	= this._gridClusters
	,	gridUnclustered	= this._gridUnclustered
	;
	
	// if(this.options.singleMarkerMode)
	// {
	// 	layer.options.icon = this.options.iconCreateFunction({
	// 		getChildCount: function () {
	// 			return 1;
	// 		},
	// 		getAllChildMarkers: function () {
	// 			return [layer];
	// 		}
	// 	});
	// }

	//Find the lowest zoom level to slot this one in
	for(; zoom >= 0; zoom--)
	{
		markerPoint = ll2px(layer, layer.getPosition(), zoom); // calculate pixel position
		
		//Try find a cluster close by
		var closest = gridClusters[zoom].getNearObject(markerPoint);
		// console.log(markerPoint, this.map.zoom);
		if(closest)
		{
			closest._addChild(layer);
			layer.__parent = closest;
			
			return;
		}
		
		//Try find a marker close by to form a new cluster with
		// console.log(markerPoint);
		closest = gridUnclustered[zoom].getNearObject(markerPoint);
		if(closest)
		{
			var parent = closest.__parent;
			if (parent){ this._removeLayer(closest, false); }
			
			//Create new cluster with these 2 in it
			var newCluster = new MarkerCluster(this, zoom, closest, layer);
			gridClusters[zoom].addObject(newCluster, ll2px(newCluster, newCluster._cPosition, zoom));
			closest.__parent = newCluster;
			layer.__parent = newCluster;
			
			//First create any new intermediate parent clusters that doesn't exist
			var lastParent = newCluster;
			for(z = zoom - 1; z > parent._zoom; z--)
			{
				lastParent = new MarkerCluster(this, z, lastParent);
				gridClusters[z].addObject(lastParent, ll2px(closest, closest.getPosition(), z));
			}
			parent._addChild(lastParent);
			
			//Remove closest from this zoom level and any above that it is in, replace with newCluster
			for(z = zoom; z >= 0; z--)
			{
				if(!gridUnclustered[z].removeObject(closest, ll2px(closest, closest.getPosition(), z))){ break; }
			}
			
			return;
		}
		
		//Didn't manage to cluster in at this zoom, record us as a marker here and continue upwards
		gridUnclustered[zoom].addObject(layer, markerPoint);
	}
	
	
	// console.log(this._topClusterLevel, layer);
	
	//Didn't get in anything, add us to the top
	this._topClusterLevel._addChild(layer);
	layer.__parent = this._topClusterLevel;
	
	return;
};

MarkerClusterGroup.prototype._removeLayer = function(marker, removeFromDistanceGrid, dontUpdateMap)
{
	var	gridClusters	= this._gridClusters,
		gridUnclustered	= this._gridUnclustered,
		fg				= this._featureGroup
	;
	
	//Remove the marker from distance clusters it might be in
	if(removeFromDistanceGrid)
	{
		for (var z = this._maxZoom; z >= 0; z--)
		{
			if(!gridUnclustered[z].removeObject(marker, ll2px(marker, marker.getPosition(), z))){ break; }
		}
	}
	
	//Work our way up the clusters removing them as we go if required
	var cluster	= marker.__parent,
		markers	= cluster._markers,
		i, otherMarker
	;
	
	//Remove the marker from the immediate parents marker list
	// this._arraySplice(markers, marker);
	if((i = markers.indexOf(marker)) > -1){ markers.splice(i, 1); }
	
	while (cluster)
	{
		cluster._childCount--;
		
		//Top level, do nothing
		if(cluster._zoom < 0){ break; }
		else if(removeFromDistanceGrid && cluster._childCount <= 1) //Cluster no longer required
		{
			//We need to push the other marker up to the parent
			otherMarker = cluster._markers[0] === marker ? cluster._markers[1] : cluster._markers[0];
			
			//Update distance grid
			gridClusters[cluster._zoom].removeObject(cluster, ll2px(cluster, cluster._cPosition, cluster._zoom));
			gridUnclustered[cluster._zoom].addObject(otherMarker, ll2px(otherMarker, otherMarker.getPosition(), cluster._zoom));
			
			//Move otherMarker up to parent
			this._arraySplice(cluster.__parent._childClusters, cluster);
			cluster.__parent._markers.push(otherMarker);
			otherMarker.__parent = cluster.__parent;
			
			if(cluster._icon)
			{
				//Cluster is currently on the map, need to put the marker on the map instead
				fg.removeLayer(cluster);
				if(!dontUpdateMap){ fg.addLayer(otherMarker); }
			}
		}
		else
		{
			cluster._recalculateBounds();
			// if(!dontUpdateMap || !cluster._icon){ cluster._updateIcon(); }
		}
		
		cluster = cluster.__parent;
	}
	
	delete marker.__parent;
};


// ======= Event Functions =======

MarkerClusterGroup.prototype._bindEvents = function()
{
	var _this = this;
	
	GE.addListener(this.map, 'zoom_changed', function(){ _this._zoomEnd(); });
	// GE.addListener(this.map, 'dragend', function(){ _this._moveEnd(); });
	// this._map.on('moveend', this._moveEnd, this);
	
	// var map = this.map,
	//     spiderfyOnMaxZoom = this.options.spiderfyOnMaxZoom,
	//     showCoverageOnHover = this.options.showCoverageOnHover,
	//     zoomToBoundsOnClick = this.options.zoomToBoundsOnClick;
	
	// //Zoom on cluster click or spiderfy if we are at the lowest level
	// if (spiderfyOnMaxZoom || zoomToBoundsOnClick) {
	// 	this.on('clusterclick', this._zoomOrSpiderfy, this);
	// }
	
	// //Show convex hull (boundary) polygon on mouse over
	// if (showCoverageOnHover) {
	// 	this.on('clustermouseover', this._showCoverage, this);
	// 	this.on('clustermouseout', this._hideCoverage, this);
	// 	map.on('zoomend', this._hideCoverage, this);
	// }
};

MarkerClusterGroup.prototype._unbindEvents = function()
{
	// map.off('zoomend', this._zoomEnd, this);
	// map.off('moveend', this._moveEnd, this);
	
	// var spiderfyOnMaxZoom = this.options.spiderfyOnMaxZoom,
	// 	showCoverageOnHover = this.options.showCoverageOnHover,
	// 	zoomToBoundsOnClick = this.options.zoomToBoundsOnClick,
	// 	map = this._map;

	// if (spiderfyOnMaxZoom || zoomToBoundsOnClick) {
	// 	this.off('clusterclick', this._zoomOrSpiderfy, this);
	// }
	// if (showCoverageOnHover) {
	// 	this.off('clustermouseover', this._showCoverage, this);
	// 	this.off('clustermouseout', this._hideCoverage, this);
	// 	map.off('zoomend', this._hideCoverage, this);
	// }
};


MarkerClusterGroup.prototype._zoomEnd = function()
{
	//May have been removed from the map by a zoomEnd handler
	if(!this._topClusterLevel){ return; }
	
	this._mergeSplitClusters();
	
	this._zoom = this.map.getZoom();
	this._currentShownBounds = this._getExpandedVisibleBounds();
};

// MarkerClusterGroup.prototype._moveEnd = function()
// {
// 	if(this._inZoomAnimation){ return; }
	
// 	var newBounds = this._getExpandedVisibleBounds();
	
// 	this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, this._zoom, newBounds);
// 	this._topClusterLevel._recursivelyAddChildrenToMap(null, this.map.getZoom(), newBounds);
	
// 	this._currentShownBounds = newBounds;
// };


// ======= Misc Functions ======

//Gets the maps visible bounds expanded in each direction by the size of the screen (so the user cannot see an area we do not cover in one pan)
MarkerClusterGroup.prototype._getExpandedVisibleBounds = function()
{
	if(!this.options.removeOutsideVisibleBounds){ return this.map.getBounds(); }
	
	var	bounds	= this.map.getBounds()
	,	sw		= bounds.getSouthWest()
	,	ne		= bounds.getNorthEast()
	,	latDiff	= Math.abs(sw.lat() - ne.lat()) // L.Browser.mobile ? 0 : Math.abs(sw.lat - ne.lat)
	,	lngDiff	= Math.abs(sw.lng() - ne.lng()) // L.Browser.mobile ? 0 : Math.abs(sw.lng - ne.lng)
	;
	
	return new GM.LatLngBounds(new GM.LatLng(sw.lat() - latDiff, sw.lng() - lngDiff, true), new GM.LatLng(ne.lat() + latDiff, ne.lng() + lngDiff, true));
};

MarkerClusterGroup.prototype._generateInitialClusters = function()
{
	var	zoom
	,	maxZoom		= this.map.maxZoom || 21
	,	radius		= this.options.maxClusterRadius
	,	radiusFn	= radius
	;
	
	//If we just set maxClusterRadius to a single number, we need to create
	//a simple function to return that number. Otherwise, we just have to
	//use the function we've passed in.
	if(typeof radius !== 'function'){ radiusFn = function(){ return radius; }; }
	
	if(this.options.disableClusteringAtZoom)
	{
		maxZoom = this.options.disableClusteringAtZoom - 1;
	}
	
	this._maxZoom			= maxZoom;
	this._gridClusters		= {};
	this._gridUnclustered	= {};
	
	//Set up DistanceGrids for each zoom
	for(zoom = maxZoom; zoom >= 0; zoom--)
	{
		this._gridClusters[zoom] = new LGM.DistanceGrid(radiusFn(zoom));
		this._gridUnclustered[zoom] = new LGM.DistanceGrid(radiusFn(zoom));
	}
	
	this._topClusterLevel = new MarkerCluster(this, -1);
};

//Merge and split any existing clusters that are too big or small
MarkerClusterGroup.prototype._mergeSplitClusters = function()
{
	//Incase we are starting to split before the animation finished
	this._processQueue();
	
	if(this._zoom < this.map.getZoom() && this._currentShownBounds.intersects(this._getExpandedVisibleBounds())) //Zoom in, split
	{
		this._animationStart();
		//Remove clusters now off screen
		this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, this._zoom, this._getExpandedVisibleBounds());
		
		this._animationZoomIn(this._zoom, this.map.getZoom());
	}
	else if (this._zoom > this.map.getZoom()) //Zoom out, merge
	{
		this._animationStart();
		this._animationZoomOut(this._zoom, this.map.getZoom());
	}
	else
	{
		console.log('TODO move end?');
		// this._moveEnd();
	}
};

MarkerClusterGroup.prototype._processQueue = function()
{
	for (var i = 0; i < this._queue.length; i++){ this._queue[i].call(this); }
	this._queue.length = 0;
	clearTimeout(this._queueTimeout);
	this._queueTimeout = null;
};


MarkerClusterGroup.prototype.getFingerprint = function()
{
	var	i
	,	fingerprint	= []
	,	layers		= this._featureGroup.layers
	,	bounds		= this.map.getBounds()
	;
	
	for(i = layers.length -1; i >= 0; --i)
	{
		if(bounds.contains(layers[i].position))
		{
			fingerprint.push(LGM.stamp(layers[i]));
		}
	}
	
	return fingerprint.join()
};


// ======= Animations Functions ======

TRANSITION = false;
if(TRANSITION)
{
	// TODO
	
	
	//Enqueue code to fire after the marker expand/contract has happened
	MarkerClusterGroup.prototype._enqueue = function(fn)
	{
		this._queue.push(fn);
		if (!this._queueTimeout) {
			this._queueTimeout = setTimeout(Function.bind.apply(this._processQueue, [this]), 300);
		}
	};
	
	//Force a browser layout of stuff in the map
	// Should apply the current opacity and location to all elements so we can update them again for an animation
	MarkerClusterGroup.prototype._forceLayout = function()
	{
		//In my testing this works, infact offsetWidth of any element seems to work.
		//Could loop all this._layers and do this for each _icon if it stops working
		
		// TODO do we need this
		// L.Util.falseFn(document.body.offsetWidth);
	};
	
	MarkerClusterGroup.prototype._animationStart = function()
	{
		this._map._mapPane.className += ' leaflet-cluster-anim';
		this._inZoomAnimation++;
	};
	
	MarkerClusterGroup.prototype._animationEnd = function()
	{
		if (this._map) {
			this._map._mapPane.className = this._map._mapPane.className.replace(' leaflet-cluster-anim', '');
		}
		this._inZoomAnimation--;
		this.fire('animationend');
	};
	
	MarkerClusterGroup.prototype._animationZoomIn = function(previousZoomLevel, newZoomLevel)
	{
		var bounds = this._getExpandedVisibleBounds(),
		    fg = this._featureGroup,
		    i;

		//Add all children of current clusters to map and remove those clusters from map
		this._topClusterLevel._recursively(bounds, previousZoomLevel, 0, function (c) {
			var startPos = c._latlng,
				markers = c._markers,
				m;

			if (!bounds.contains(startPos)) {
				startPos = null;
			}

			if (c._isSingleParent() && previousZoomLevel + 1 === newZoomLevel) { //Immediately add the new child and remove us
				fg.removeLayer(c);
				c._recursivelyAddChildrenToMap(null, newZoomLevel, bounds);
			} else {
				//Fade out old cluster
				c.setOpacity(0);
				c._recursivelyAddChildrenToMap(startPos, newZoomLevel, bounds);
			}

			//Remove all markers that aren't visible any more
			//TODO: Do we actually need to do this on the higher levels too?
			for (i = markers.length - 1; i >= 0; i--) {
				m = markers[i];
				if (!bounds.contains(m._latlng)) {
					fg.removeLayer(m);
				}
			}

		});

		this._forceLayout();

		//Update opacities
		this._topClusterLevel._recursivelyBecomeVisible(bounds, newZoomLevel);
		//TODO Maybe? Update markers in _recursivelyBecomeVisible
		fg.eachLayer(function (n) {
			if (!(n instanceof MarkerCluster) && n._icon) {
				n.setOpacity(1);
			}
		});

		//update the positions of the just added clusters/markers
		this._topClusterLevel._recursively(bounds, previousZoomLevel, newZoomLevel, function (c) {
			c._recursivelyRestoreChildPositions(newZoomLevel);
		});

		//Remove the old clusters and close the zoom animation
		this._enqueue(function () {
			//update the positions of the just added clusters/markers
			this._topClusterLevel._recursively(bounds, previousZoomLevel, 0, function (c) {
				fg.removeLayer(c);
				c.setOpacity(1);
			});

			this._animationEnd();
		});
	};
	
	MarkerClusterGroup.prototype._animationZoomOut = function(previousZoomLevel, newZoomLevel)
	{
		this._animationZoomOutSingle(this._topClusterLevel, previousZoomLevel - 1, newZoomLevel);

		//Need to add markers for those that weren't on the map before but are now
		this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
		//Remove markers that were on the map before but won't be now
		this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel, this._getExpandedVisibleBounds());
	};
	
	MarkerClusterGroup.prototype._animationZoomOutSingle = function(cluster, previousZoomLevel, newZoomLevel)
	{
		var bounds = this._getExpandedVisibleBounds();

		//Animate all of the markers in the clusters to move to their cluster center point
		cluster._recursivelyAnimateChildrenInAndAddSelfToMap(bounds, previousZoomLevel + 1, newZoomLevel);

		var me = this;

		//Update the opacity (If we immediately set it they won't animate)
		this._forceLayout();
		cluster._recursivelyBecomeVisible(bounds, newZoomLevel);

		//TODO: Maybe use the transition timing stuff to make this more reliable
		//When the animations are done, tidy up
		this._enqueue(function () {

			//This cluster stopped being a cluster before the timeout fired
			if (cluster._childCount === 1) {
				var m = cluster._markers[0];
				//If we were in a cluster animation at the time then the opacity and position of our child could be wrong now, so fix it
				m.setLatLng(m.getLatLng());
				if (m.setOpacity) {
					m.setOpacity(1);
				}
			} else {
				cluster._recursively(bounds, newZoomLevel, 0, function (c) {
					c._recursivelyRemoveChildrenFromMap(bounds, previousZoomLevel + 1);
				});
			}
			me._animationEnd();
		});
	};
	
	MarkerClusterGroup.prototype._animationAddLayer = function(layer, newCluster)
	{
		var me = this,
			fg = this._featureGroup;

		fg.addLayer(layer);
		if (newCluster !== layer) {
			if (newCluster._childCount > 2) { //Was already a cluster

				newCluster._updateIcon();
				this._forceLayout();
				this._animationStart();

				layer._setPos(this._map.latLngToLayerPoint(newCluster.getLatLng()));
				layer.setOpacity(0);

				this._enqueue(function () {
					fg.removeLayer(layer);
					layer.setOpacity(1);

					me._animationEnd();
				});

			} else { //Just became a cluster
				this._forceLayout();

				me._animationStart();
				me._animationZoomOutSingle(newCluster, this._map.getMaxZoom(), this._map.getZoom());
			}
		}
	};
}
else
{
	MarkerClusterGroup.prototype._animationStart = function()
	{
		//Do nothing...
	};
	
	MarkerClusterGroup.prototype._animationZoomIn = function(previousZoomLevel, newZoomLevel)
	{
		this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel);
		this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
		
		//We didn't actually animate, but we use this event to mean "clustering animations have finished"
		// this.fire('animationend');
	};
	
	MarkerClusterGroup.prototype._animationZoomOut = function(previousZoomLevel, newZoomLevel)
	{
		this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel);
		this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
		
		//We didn't actually animate, but we use this event to mean "clustering animations have finished"
		// this.fire('animationend');
	};
	
	MarkerClusterGroup.prototype._animationAddLayer = function(layer, newCluster)
	{
		if(newCluster === layer)
		{
			this._featureGroup.addLayer(layer);
		}
		else if(newCluster._childCount === 2)
		{
			newCluster._addToMap();
			
			var markers = newCluster.getAllChildMarkers();
			this._featureGroup.removeLayer(markers[0]);
			this._featureGroup.removeLayer(markers[1]);
		}
		else
		{
			newCluster._updateIcon();
		}
	};
}


// }(window, document));









/*

==== FEATURES

TODO: ??? _isSingleParent

==== OPTIMIZATIONS
TODO: "this" should be a variable
TODO: This loop is the same as above (lood down in _recursively)


==== STYLES
TODO: styles
	- spacing: ifs, fors, whiles, functions, etc,
	- braces, brackets
	- var declarations: first non-initialized, align, commas, colons
	- function names and variable names

TODO: migrate to grunt and livescript

*/


// (function (window, document, undefined)
// {


var	GM = google.maps
,	GE = GM.event
;




function MarkerCluster(group, zoom, a, b)
{
	// extend(MarkerCluster, GM.OverlayView);
	
	this._group				= group;
	this._zoom				= zoom;
	
	this._markers			= [];
	this._childClusters		= [];
	this._childCount		= 0;
	this._iconNeedsUpdate	= true;
	
	this._bounds			= new GM.LatLngBounds();
	
	this._div				= null;
	this._div_count			= null;
	
	if(a){ this._addChild(a); }
	if(b){ this._addChild(b); }
}

MarkerCluster.prototype = new GM.OverlayView();


// ======= Google Maps Functions =======

MarkerCluster.prototype.draw = function()
{
	var pos = this.getProjection().fromLatLngToDivPixel(this.position);
	this._div.style.top		= pos.y + 'px';
	this._div.style.left	= pos.x + 'px';
};

MarkerCluster.prototype.onRemove = function()
{
	this._div.parentNode.removeChild(this._div);
	// this._div = null;
};

MarkerCluster.prototype.onAdd = function()
{
	if(!this._div)
	{
		var div, count;
		
		this._div		= div	= document.createElement('div');
		this._div_count	= count	= document.createElement('div');
		
		div._cluster = this;
		div.appendChild(count);
		
		count.className = 'cluster-count';
		
		this._updateIcon();
		
		GE.addDomListener(div, 'click', this._zoomOrSpiderfy);
		
	}
	
	this.getPanes().overlayMouseTarget.appendChild(this._div);
};


// ======= !!!!!!!!!!!!! Functions =======


MarkerCluster.prototype._addChild = function(new1, isNotificationFromChild)
{
	this._iconNeedsUpdate = true;
	this._expandBounds(new1);
	
	if(new1 instanceof MarkerCluster)
	{
		if(!isNotificationFromChild)
		{
			this._childClusters.push(new1);
			new1.__parent = this;
		}
		
		this._childCount += new1._childCount;
	}
	else
	{
		if(!isNotificationFromChild)
		{
			this._markers.push(new1);
		}
		this._childCount++;
	}
	
	if(this.__parent){ this.__parent._addChild(new1, true); }
};

//Expand our bounds and tell our parent to
MarkerCluster.prototype._expandBounds = function(marker)
{
	var lat, lng, addedCount, addedPosition = marker._wPosition || marker.position;
	
	// console.log(marker, addedPosition);
	if(marker instanceof MarkerCluster)
	{
		// console.info(this._bounds, marker._bounds);
		this._bounds.union(marker._bounds);
		addedCount = marker._childCount;
	}
	else
	{
		this._bounds.extend(addedPosition);
		// console.info(this._bounds);
		addedCount = 1;
	}
	
	if(!this._cPosition)
	{
		// when clustering, take position of the first point as the cluster center
		this._cPosition = marker._cPosition || addedPosition;
	}
	
	// when showing clusters, take weighted average of all points as cluster center
	var totalCount = this._childCount + addedCount;
	
	//Calculate weighted latlng for display
	if(this._wPosition)
	{
		lat = (addedPosition.lat() * addedCount + this._wPosition.lat() * this._childCount) / totalCount;
		lng = (addedPosition.lng() * addedCount + this._wPosition.lng() * this._childCount) / totalCount;
		
		addedPosition = new GM.LatLng(lat, lng);
	}
	
	// TODO may need to be setPosition
	this.position = this._wPosition = new GM.LatLng(addedPosition.lat(), addedPosition.lng());
};

// This is not needed
MarkerCluster.prototype.getChildCount = function(){ return this._childCount; };

MarkerCluster.prototype.getAllChildMarkers = function()
{
	storageArray = this._markers.slice();
	
	// for(var j = this._markers.length - 1; j >= 0; j--)
	// {
	// 	storageArray.push(this._markers[j]);
	// }
	
	for(var i = this._childClusters.length - 1; i >= 0; i--)
	{
		storageArray.concat(this._childClusters[i].getAllChildMarkers(storageArray));
	}
	
	return storageArray;
};

MarkerCluster.prototype._recursivelyAddChildrenToMap = function(startPos, zoomLevel, bounds)
{
	this._recursively(bounds, -1, zoomLevel, function(c)
	{
		// return;
		if(zoomLevel === c._zoom){ return; }
		
		//Add our child markers at startPos (so they can be animated out)
		for(var i = c._markers.length - 1; i >= 0; i--)
		{
			var nm = c._markers[i];
			
			if(!bounds.contains(nm.position)){ continue; }
			
			// console.log(startPos);
			if(startPos)
			{
				nm._backupLatlng = nm.getPosition();
				
				nm.setPosition(startPos);
				if(nm.setOpacity){ nm.setOpacity(0); }
			}
			
			// console.log(nm);
			c._group._featureGroup.addLayer(nm);
		}
	}, function(c){ c._addToMap(startPos); });
};

//exceptBounds: If set, don't remove any markers/clusters in it
MarkerCluster.prototype._recursivelyRemoveChildrenFromMap = function(previousBounds, zoomLevel, exceptBounds)
{
	var m, i;
	this._recursively
	(
		previousBounds, -1, zoomLevel - 1,
		function(c)
		{
			//Remove markers at every level
			for(i = c._markers.length - 1; i >= 0; i--)
			{
				m = c._markers[i];
				if(!exceptBounds || !exceptBounds.contains(m.position))
				{
					c._group._featureGroup.removeLayer(m);
					// if (m.setOpacity){ m.setOpacity(1); }
				}
			}
		},
		function (c) {
			//Remove child clusters at just the bottom level
			for(i = c._childClusters.length - 1; i >= 0; i--)
			{
				m = c._childClusters[i];
				if(!exceptBounds || !exceptBounds.contains(m.position))
				{
					c._group._featureGroup.removeLayer(m);
					// if (m.setOpacity){ m.setOpacity(1); }
				}
			}
		}
	);
};


//Run the given functions recursively to this and child clusters
// boundsToApplyTo: a LatLngBounds representing the bounds of what clusters to recurse in to
// zoomLevelToStart: zoom level to start running functions (inclusive)
// zoomLevelToStop: zoom level to stop running functions (inclusive)
// runAtEveryLevel: function that takes an MarkerCluster as an argument that should be applied on every level
// runAtBottomLevel: function that takes an MarkerCluster as an argument that should be applied at only the bottom level
MarkerCluster.prototype._recursively = function(boundsToApplyTo, zoomLevelToStart, zoomLevelToStop, runAtEveryLevel, runAtBottomLevel)
{
	var	i, c
	,	childClusters	= this._childClusters
	,	zoom			= this._zoom
	;

	if(zoomLevelToStart > zoom) //Still going down to required depth, just recurse to child clusters
	{
		for(i = childClusters.length - 1; i >= 0; i--)
		{
			c = childClusters[i];
			if(boundsToApplyTo.intersects(c._bounds))
			{
				c._recursively(boundsToApplyTo, zoomLevelToStart, zoomLevelToStop, runAtEveryLevel, runAtBottomLevel);
			}
		}
	}
	else //In required depth
	{
		if(runAtEveryLevel)
		{
			runAtEveryLevel(this);
		}
		
		if(runAtBottomLevel && this._zoom === zoomLevelToStop)
		{
			runAtBottomLevel(this);
		}
		
		//TODO: This loop is the same as above
		if(zoomLevelToStop > zoom)
		{
			for(i = childClusters.length - 1; i >= 0; i--)
			{
				c = childClusters[i];
				if(boundsToApplyTo.intersects(c._bounds))
				{
					c._recursively(boundsToApplyTo, zoomLevelToStart, zoomLevelToStop, runAtEveryLevel, runAtBottomLevel);
				}
			}
		}
	}
};

MarkerCluster.prototype._addToMap = function(startPos)
{
	if(startPos)
	{
		this._backupLatlng = this.position;
		this.setPosition(startPos);
	}
	
	// this.setMap(this._group.map)
	// console.log(this._group.map);
	this._group._featureGroup.addLayer(this);
};

MarkerCluster.prototype._recalculateBounds = function()
{
	var markers = this._markers,
		childClusters = this._childClusters,
		i;
	
	this._bounds = new GM.LatLngBounds();
	delete this._wPosition;
	
	for(i = markers.length - 1; i >= 0; i--){ this._expandBounds(markers[i]); }
	for(i = childClusters.length - 1; i >= 0; i--){ this._expandBounds(childClusters[i]); }
};


// EVENT
MarkerCluster.prototype._zoomOrSpiderfy = function(ev)
{
	var	cluster	= this._cluster
	,	map		= cluster.map
	,	options	= cluster._group.options;
	// console.log(map.getZoom() === map.getMaxZoom());
	
	/*if(this._bounds._northEast.equals(e.layer._bounds._southWest))
	{
		if (this.options.spiderfyOnMaxZoom) {
			e.layer.spiderfy();
		}
	} 
	else*/ if(map.getZoom() === (map.maxZoom || 21))
	{
		if(options.spiderfyOnMaxZoom){ cluster.spiderfy(); }
	}
	else if(options.zoomToBoundsOnClick)
	{
		cluster.zoomToBounds();
	}
	
	// Focus the map again for keyboard users.
	// if (e.originalEvent && e.originalEvent.keyCode === 13) {
	// 	map._container.focus();
	// }
};

MarkerCluster.prototype.zoomToBounds = function()
{
	var map = this._group.map
	// var childClusters = this._childClusters.slice(),
	// 	boundsZoom = map.getBoundsZoom(this._bounds),
	// 	zoom = this._zoom + 1,
	// 	mapZoom = map.getZoom(),
	// 	i;
	;
	
	//calculate how far we need to zoom down to see all of the markers
	// while (childClusters.length > 0 && boundsZoom > zoom) {
	// 	zoom++;
	// 	var newClusters = [];
	// 	for(i = 0; i < childClusters.length; i++)
	// 	{
	// 		newClusters = newClusters.concat(childClusters[i]._childClusters);
	// 	}
	// 	childClusters = newClusters;
	// }
	
	// if(boundsZoom > zoom)
	// {
	// 	this._group._map.setView(this._latlng, zoom);
	// }
	// else if(boundsZoom <= mapZoom) //If fitBounds wouldn't zoom us down, zoom us down instead
	// {
	// 	this._group._map.setView(this._latlng, mapZoom + 1);
	// }
	// else
	// {
		map.fitBounds(this._bounds);
	// }
}

MarkerCluster.prototype._updateIcon = function()
{
	if(!this._div){ return null; }
	
	this._div.className = 'cluster cluster-size-' + ('' + this._childCount).length;
	this._div_count.innerHTML = this._childCount;
};


if(TRANSITION)
{
	MarkerCluster.prototype._recursivelyAnimateChildrenIn = function(bounds, center, maxZoom){
		this._recursively(bounds, 0, maxZoom - 1,
			function (c) {
				var markers = c._markers,
					i, m;
				for (i = markers.length - 1; i >= 0; i--) {
					m = markers[i];

					//Only do it if the icon is still on the map
					if (m._icon) {
						m._setPos(center);
						m.setOpacity(0);
					}
				}
			},
			function (c) {
				var childClusters = c._childClusters,
					j, cm;
				for (j = childClusters.length - 1; j >= 0; j--) {
					cm = childClusters[j];
					if (cm._icon) {
						cm._setPos(center);
						cm.setOpacity(0);
					}
				}
			}
		);
	};
	
	MarkerCluster.prototype._recursivelyAnimateChildrenInAndAddSelfToMap = function(bounds, previousZoomLevel, newZoomLevel){
		this._recursively(bounds, newZoomLevel, 0,
			function (c) {
				c._recursivelyAnimateChildrenIn(bounds, c._group._map.latLngToLayerPoint(c.getLatLng()).round(), previousZoomLevel);

				//TODO: depthToAnimateIn affects _isSingleParent, if there is a multizoom we may/may not be.
				//As a hack we only do a animation free zoom on a single level zoom, if someone does multiple levels then we always animate
				if (c._isSingleParent() && previousZoomLevel - 1 === newZoomLevel) {
					c.setOpacity(1);
					c._recursivelyRemoveChildrenFromMap(bounds, previousZoomLevel); //Immediately remove our children as we are replacing them. TODO previousBounds not bounds
				} else {
					c.setOpacity(0);
				}

				c._addToMap();
			}
		);
	};
	
	MarkerCluster.prototype._recursivelyBecomeVisible = function(bounds, zoomLevel){
		this._recursively(bounds, 0, zoomLevel, null, function (c) {
			c.setOpacity(1);
		});
	};
	
	MarkerCluster.prototype._recursivelyRestoreChildPositions = function(zoomLevel){
		//Fix positions of child markers
		for (var i = this._markers.length - 1; i >= 0; i--) {
			var nm = this._markers[i];
			if (nm._backupLatlng) {
				nm.setLatLng(nm._backupLatlng);
				delete nm._backupLatlng;
			}
		}

		if (zoomLevel - 1 === this._zoom) {
			//Reposition child clusters
			for (var j = this._childClusters.length - 1; j >= 0; j--) {
				this._childClusters[j]._restorePosition();
			}
		} else {
			for (var k = this._childClusters.length - 1; k >= 0; k--) {
				this._childClusters[k]._recursivelyRestoreChildPositions(zoomLevel);
			}
		}
	};
	
	MarkerCluster.prototype._restorePosition = function(){
		if (this._backupLatlng) {
			this.setLatLng(this._backupLatlng);
			delete this._backupLatlng;
		}
	};
}




LGM = {};

LGM.lastStampId = 0;
LGM.stamp = function(obj)
{
	obj.__stamp_id = obj.__stamp_id || ++LGM.lastStampId;
	return obj.__stamp_id;
};

LGM.DistanceGrid = function (cellSize)
{
	this._cellSize		= cellSize;
	this._sqCellSize	= cellSize * cellSize;
	this._grid			= {};
	this._objectPoint	= {};
};


LGM.DistanceGrid.prototype =
{
	addObject: function(obj, point)
	{
		var	p		= this._getCoords(point)
		,	grid	= this._grid
		,	row		= grid[p._y]	= grid[p._y]	|| {}
		,	cell	= row[p._x]		= row[p._x]		|| []
		;
		
		this._objectPoint[LGM.stamp(obj)] = point;
		
		cell.push(obj);
	},
	
	updateObject: function(obj, point)
	{
		this.removeObject(obj);
		this.addObject(obj, point);
	},
	
	//Returns true if the object was found
	removeObject: function(obj, point)
	{
		var	i
		,	p		= this._getCoords(point)
		,	grid	= this._grid
		,	row		= grid[p._y]	= grid[p._y]	|| {}
		,	cell	= row[p._x]		= row[p._x]		|| []
		;
		
		delete this._objectPoint[LGM.stamp(obj)];
		
		i = cell.indexOf(obj);
		if(i > -1)
		// for(i = 0, len = cell.length; i < len; i++)
		{
			// if(cell[i] === obj){
			cell.splice(i, 1);
			
			if(cell.length === 1)
			{
				delete row[p._x];
			}
			
			return true;
			// }
		}
	},
	
	// eachObject: function(fn, context)
	// {
	// 	var i, j, k, len, row, cell, removed, grid = this._grid;
		
	// 	for(i in grid)
	// 	{
	// 		row = grid[i];
			
	// 		for(j in row)
	// 		{
	// 			cell = row[j];
				
	// 			for(k = 0, len = cell.length; k < len; k++)
	// 			{
	// 				removed = fn.call(context, cell[k]);
	// 				if(removed){ k--; len--; }
	// 			}
	// 		}
	// 	}
	// },
	
	getNearObject: function (point)
	{
		var i, j, k, row, cell, len, obj, dist
		,	p				= this._getCoords(point)
		,	objectPoint		= this._objectPoint
		,	closestDistSq	= this._sqCellSize
		,	closest			= null
		;
		
		// TODO this should help increase performance a little bit and it should not matter a lot for the clusters
		// if((row = this._grid[p._y]) && (cell = row[p._x]) && cell[0]){ return cell[0] }
		
		for(i = p._y - 1; i <= p._y + 1; i++)
		{
			if(row = this._grid[i])
			{
				for(j = p._x - 1; j <= p._x + 1; j++)
				{
					if(cell = row[j])
					{
						for(k = 0, len = cell.length; k < len; k++)
						{
							obj		= cell[k];
							dist	= this._sqDist(objectPoint[LGM.stamp(obj)], point);
							if(dist < closestDistSq)
							{
								closestDistSq	= dist;
								closest			= obj;
							}
						}
					}
				}
			}
		}
		
		return closest;
	},
	
	_getCoords: function(point)
	{
		if(!point._x || !point._y)
		{
			point._x = Math.floor(point.x / this._cellSize);
			point._y = Math.floor(point.y / this._cellSize);
		}
		
		return point;
	},
	
	_sqDist: function(p, p2)
	{
		var	dx = p2.x - p.x
		,	dy = p2.y - p.y
		;
		return dx * dx + dy * dy;
	}
};



//This code is 100% based on https://github.com/jawj/OverlappingMarkerSpiderfier-Leaflet
//Huge thanks to jawj for implementing it first to make my job easy :-)



MarkerCluster.prototype.spiderfy = function()
{
	if (this._group._spiderfied === this || this._group._inZoomAnimation){ return; }
	
	var	positions
	,	childMarkers	= this.getAllChildMarkers()
	,	group			= this._group
	,	center			= group.getProjection().fromLatLngToContainerPixel(this.position)
	;
	
	// console.warn(center, this.position);
	
	group._unspiderfy();
	group._spiderfied = this;
	
	//TODO Maybe: childMarkers order by distance to center
	if (childMarkers.length >= this._circleSpiralSwitchover) {
		positions = this._generatePointsSpiral(childMarkers.length, center);
	} else {
		center.y += 10; //Otherwise circles look wrong
		positions = this._generatePointsCircle(childMarkers.length, center);
	}
	
	this._animationSpiderfy(childMarkers, positions);
};


MarkerCluster.prototype.unspiderfy = function(zoomDetails)
{
	if(this._group._inZoomAnimation){ return; }
	
	this._animationUnspiderfy(zoomDetails);
	this._group._spiderfied = null;
};


MarkerCluster.prototype._2PI					= Math.PI * 2;
MarkerCluster.prototype._circleStartAngle		= Math.PI / 6;
MarkerCluster.prototype._circleFootSeparation	= 23; // related to circumference of circle

MarkerCluster.prototype._spiralFootSeparation	= 26; // related to size of spiral (experiment!)
MarkerCluster.prototype._spiralLengthStart		= 11;
MarkerCluster.prototype._spiralLengthFactor		= 4;

// show spiral instead of circle from this marker count upwards.
// 0 -> always spiral; Infinity -> always circle
MarkerCluster.prototype._circleSpiralSwitchover	= 9;


MarkerCluster.prototype._generatePointsCircle = function(count, centerPt)
{
	var circumference = this._group.options.spiderfyDistanceMultiplier * this._circleFootSeparation * (2 + count),
		legLength = circumference / this._2PI,  //radius from circumference
		angleStep = this._2PI / count,
		res = new Array(count),
		i, angle;
	
	for(i = count - 1; i >= 0; i--)
	{
		angle = this._circleStartAngle + i * angleStep;
		res[i] = new GM.Point(parseInt(centerPt.x + legLength * Math.cos(angle)), parseInt(centerPt.y + legLength * Math.sin(angle)));
	}
	
	return res;
};


MarkerCluster.prototype._generatePointsSpiral = function(count, centerPt)
{
	var	options			= this._group.options,
		legLength		= options.spiderfyDistanceMultiplier * this._spiralLengthStart,
		separation		= options.spiderfyDistanceMultiplier * this._spiralFootSeparation,
		lengthFactor	= options.spiderfyDistanceMultiplier * this._spiralLengthFactor,
		angle			= 0,
		res				= new Array(count),
		i;
	
	for (i = count - 1; i >= 0; i--)
	{
		angle += separation / legLength + i * 0.0005;
		res[i] = new GM.Point(parseInt(centerPt.x + legLength * Math.cos(angle)), parseInt((centerPt.y + legLength * Math.sin(angle))));
		legLength += this._2PI * lengthFactor / angle;
	}
	
	return res;
};


if(TRANSITION)
{
	/*
	MarkerCluster.prototype.SVG_ANIMATION = (function()
	{
		return document.createElementNS('http://www.w3.org/2000/svg', 'animate').toString().indexOf('SVGAnimate') > -1;
	}()),
	
	MarkerCluster.prototype._animationSpiderfy = function(childMarkers, positions)
	{
		var me = this,
			group = this._group,
			map = group._map,
			fg = group._featureGroup,
			thisLayerPos = map.latLngToLayerPoint(this._latlng),
			i, m, leg, newPos;

		//Add markers to map hidden at our center point
		for (i = childMarkers.length - 1; i >= 0; i--) {
			m = childMarkers[i];

			//If it is a marker, add it now and we'll animate it out
			if (m.setOpacity) {
				m.setZIndexOffset(1000000); //Make these appear on top of EVERYTHING
				m.setOpacity(0);
			
				fg.addLayer(m);

				m._setPos(thisLayerPos);
			} else {
				//Vectors just get immediately added
				fg.addLayer(m);
			}
		}

		group._forceLayout();
		group._animationStart();

		var initialLegOpacity = L.Path.SVG ? 0 : 0.3,
			xmlns = L.Path.SVG_NS;


		for (i = childMarkers.length - 1; i >= 0; i--) {
			newPos = map.layerPointToLatLng(positions[i]);
			m = childMarkers[i];

			//Move marker to new position
			m._preSpiderfyLatlng = m._latlng;
			m.setLatLng(newPos);
			
			if (m.setOpacity) {
				m.setOpacity(1);
			}


			//Add Legs.
			leg = new L.Polyline([me._latlng, newPos], { weight: 1.5, color: '#222', opacity: initialLegOpacity });
			map.addLayer(leg);
			m._spiderLeg = leg;

			//Following animations don't work for canvas
			if (!L.Path.SVG || !this.SVG_ANIMATION) {
				continue;
			}

			//How this works:
			//http://stackoverflow.com/questions/5924238/how-do-you-animate-an-svg-path-in-ios
			//http://dev.opera.com/articles/view/advanced-svg-animation-techniques/

			//Animate length
			var length = leg._path.getTotalLength();
			leg._path.setAttribute("stroke-dasharray", length + "," + length);

			var anim = document.createElementNS(xmlns, "animate");
			anim.setAttribute("attributeName", "stroke-dashoffset");
			anim.setAttribute("begin", "indefinite");
			anim.setAttribute("from", length);
			anim.setAttribute("to", 0);
			anim.setAttribute("dur", 0.25);
			leg._path.appendChild(anim);
			anim.beginElement();

			//Animate opacity
			anim = document.createElementNS(xmlns, "animate");
			anim.setAttribute("attributeName", "stroke-opacity");
			anim.setAttribute("attributeName", "stroke-opacity");
			anim.setAttribute("begin", "indefinite");
			anim.setAttribute("from", 0);
			anim.setAttribute("to", 0.5);
			anim.setAttribute("dur", 0.25);
			leg._path.appendChild(anim);
			anim.beginElement();
		}
		me.setOpacity(0.3);

		//Set the opacity of the spiderLegs back to their correct value
		// The animations above override this until they complete.
		// If the initial opacity of the spiderlegs isn't 0 then they appear before the animation starts.
		if (L.Path.SVG) {
			this._group._forceLayout();

			for (i = childMarkers.length - 1; i >= 0; i--) {
				m = childMarkers[i]._spiderLeg;

				m.options.opacity = 0.5;
				m._path.setAttribute('stroke-opacity', 0.5);
			}
		}

		setTimeout(function () {
			group._animationEnd();
			group.fire('spiderfied');
		}, 200);
	},
	
	MarkerCluster.prototype._animationUnspiderfy = function(zoomDetails)
	{
		var group = this._group,
			map = group._map,
			fg = group._featureGroup,
			thisLayerPos = zoomDetails ? map._latLngToNewLayerPoint(this._latlng, zoomDetails.zoom, zoomDetails.center) : map.latLngToLayerPoint(this._latlng),
			childMarkers = this.getAllChildMarkers(),
			svg = L.Path.SVG && this.SVG_ANIMATION,
			m, i, a;

		group._animationStart();

		//Make us visible and bring the child markers back in
		this.setOpacity(1);
		for (i = childMarkers.length - 1; i >= 0; i--) {
			m = childMarkers[i];

			//Marker was added to us after we were spidified
			if (!m._preSpiderfyLatlng) {
				continue;
			}

			//Fix up the location to the real one
			m.setLatLng(m._preSpiderfyLatlng);
			delete m._preSpiderfyLatlng;
			//Hack override the location to be our center
			if (m.setOpacity) {
				m._setPos(thisLayerPos);
				m.setOpacity(0);
			} else {
				fg.removeLayer(m);
			}

			//Animate the spider legs back in
			if (svg) {
				a = m._spiderLeg._path.childNodes[0];
				a.setAttribute('to', a.getAttribute('from'));
				a.setAttribute('from', 0);
				a.beginElement();

				a = m._spiderLeg._path.childNodes[1];
				a.setAttribute('from', 0.5);
				a.setAttribute('to', 0);
				a.setAttribute('stroke-opacity', 0);
				a.beginElement();

				m._spiderLeg._path.setAttribute('stroke-opacity', 0);
			}
		}

		setTimeout(function () {
			//If we have only <= one child left then that marker will be shown on the map so don't remove it!
			var stillThereChildCount = 0;
			for (i = childMarkers.length - 1; i >= 0; i--) {
				m = childMarkers[i];
				if (m._spiderLeg) {
					stillThereChildCount++;
				}
			}


			for (i = childMarkers.length - 1; i >= 0; i--) {
				m = childMarkers[i];

				if (!m._spiderLeg) { //Has already been unspiderfied
					continue;
				}


				if (m.setOpacity) {
					m.setOpacity(1);
					m.setZIndexOffset(0);
				}

				if (stillThereChildCount > 1) {
					fg.removeLayer(m);
				}

				map.removeLayer(m._spiderLeg);
				delete m._spiderLeg;
			}
			group._animationEnd();
		}, 200);
	}
	*/
}
else
{
	MarkerCluster.prototype._animationSpiderfy = function(childMarkers, positions)
	{
		var group = this._group,
			map = group.map,
			fg = group._featureGroup,
			i, m, leg, newPos;
		
		for(i = childMarkers.length - 1; i >= 0; i--)
		{
			newPos = group.getProjection().fromContainerPixelToLatLng(positions[i]);
			
			m = childMarkers[i];
			m._preSpiderfyPosition = m.position;
			m.setPosition(newPos);
			
			// console.log(m.position.toUrlValue(), positions[i].x, positions[i].y);
			fg.addLayer(m);
			
			leg = new GM.Polyline({ map: map, path: [this.position, newPos], strokeWeight: 1.5, strokeColor: '#333', strokeOpacity: 0.5 });
			m._spiderLeg = leg;
		}
		
		this._div.style.display = 'none';
		
		// this.setOpacity(0.3);
		
		// group.fire('spiderfied');
	};
	
	MarkerCluster.prototype._animationUnspiderfy = function()
	{
		var group = this._group,
			map = group._map,
			fg = group._featureGroup,
			childMarkers = this.getAllChildMarkers(),
			m, i;
		
		for(i = childMarkers.length - 1; i >= 0; i--)
		{
			m = childMarkers[i];
			
			fg.removeLayer(m);
			
			if(m._preSpiderfyPosition)
			{
				m.setPosition(m._preSpiderfyPosition);
				delete m._preSpiderfyLatlng;
			}
			// if (m.setZIndexOffset) {
			// 	m.setZIndexOffset(0);
			// }
			
			if(m._spiderLeg)
			{
				m._spiderLeg.setMap(null);
				delete m._spiderLeg;
			}
		}
		
		this._div.style.display = 'block';
		
		group._spiderfied = null;
	};
}





// TODO get all spiderifying outside of MarkerCluster

MarkerClusterGroup.prototype._spiderfied = null;

MarkerClusterGroup.prototype._spiderfierOnAdd = function()
{
	var _this = this;
	// GE.addListener(this.map, 'click', function(e){ _this._unspiderfy(); });
	
	// if (this._map.options.zoomAnimation) {
	// 	this._map.on('zoomstart', this._unspiderfyZoomStart, this);
	// }
	//Browsers without zoomAnimation or a big zoom don't fire zoomstart
	GE.addListener(this.map, 'zoom_changed', function(){ _this._noanimationUnspiderfy(); });
	
	// if (L.Path.SVG && !L.Browser.touch) {
	// 	this.map._initPathRoot();
	// 	//Needs to happen in the pageload, not after, or animations don't work in webkit
	// 	//  http://stackoverflow.com/questions/8455200/svg-animate-with-dynamically-added-elements
	// 	//Disable on touch browsers as the animation messes up on a touch zoom and isn't very noticable
	// }
};

MarkerClusterGroup.prototype._unspiderfy = function(zoomDetails)
{
	if(this._spiderfied){ this._spiderfied.unspiderfy(zoomDetails); }
};

MarkerClusterGroup.prototype._noanimationUnspiderfy = function()
{
	if(this._spiderfied){ this._spiderfied._animationUnspiderfy(); }
};

