/*
 MarkerClusterGroup - Provides beautiful marker clustering functionality for Google Maps API v3.
 https://github.com/Avalith/MarkerClusterGroup
 (c) 2015, Alexander Ivanov - Karamfil (https://github.com/karamfil/)
*/

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

(function()
{
	var	GM = google.maps
	,	GE = GM.event
	;
	
	// TODO: get rid of this? or refactor it
	function FeatureGroup()
	{
		this.map = null;
		this.layers = [];
		this.layers_i = {};
		
		this.addLayer = function(layer)
		{
			if(!this.map){ return; }
			
			this.layers_i[layer.__stamp_id] = this.layers.push(layer) - 1;
			
			layer.setMap(this.map);
		};
		
		this.removeLayer = function(layer)
		{
			var s = layer.__stamp_id, i = this.layers_i[s];
			
			if(i)
			{
				this.layers[i].setMap(null);
				delete this.layers_i[s];
				delete this.layers[i];
			}
		};
		
		this.eachLayer = function(cb)
		{
			// console.log(this.layers);
			for(var v, i = 0; i < this.layers.length; i++)
			{
				if(v = this.layers[i])
				{
					cb(v);
				}
				else
				{
					this.layers.splice(i, 1);
					i--;
				}
			}
		};
		
		this.clearLayers = function(cb)
		{
			for(var i = 0; i < this.layers.length; i++){ this.layers[i].setMap(null); }
			this.layers = [];
			this.layers_i = {};
		};
	}
	
	
	MAP.MarkerClusterGroup = function(options)
	{
		this._featureGroup = new FeatureGroup();
		
		this._inZoomAnimation	= 0;
		this._needsClustering	= [];
		this._needsClustering_i	= {};
		this._needsRemoving		= [];
		this._needsRemoving_i	= {};
		
		this.options = MAP.extend(
		{
			maxClusterRadius: 80,			// A cluster will cover at most this many pixels from its center
			
			zoomToBoundsOnClick: true,
			
			spiderfyOnMaxZoom: true,
			spiderfyDistanceMultiplier: 1,	// Increase to increase the distance away that spiderfied markers appear from the center
			
			disableClusteringAtZoom: null,
			// animateAddingMarkers: false,
			
			// Setting this to false prevents the removal of any clusters outside of the viewpoint, which
			// is the default behaviour for performance reasons.
			// removeOutsideVisibleBounds: true,
			
			chunkedLoading	: false,
			chunkInterval	: 200,			// process markers for a maximum of ~ n milliseconds (then trigger the chunkProgress callback)
			chunkDelay		: 1,			// at the end of each interval, give n milliseconds back to system/browser
			chunkProgress	: null			// progress callback: function(processed, total, elapsed) (e.g. for a progress indicator)
		}, options);
		
		this._queue = [];
	};
	
	MAP.MarkerClusterGroup.prototype = new GM.OverlayView();
	
	
	MAP.MarkerClusterGroup.prototype.ll2px = (function()
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
			var	siny
			,	ntiles	= 1 << zoom
			,	point	= new GM.Point(0, 0)
			;
			
			// Truncating to 0.9999 effectively limits latitude to 89.189. This is about a third of a tile past the edge of the world tile.
			siny = bound(Math.sin(deg2rad(lat_lng.lat())), -0.9999, 0.9999);
			
			point.x = parseInt((px_origin.x + lat_lng.lng() * px_per_lon_deg) * ntiles);
			point.y = parseInt((px_origin.y + 0.5 * Math.log((1 + siny) / (1 - siny)) * -px_per_lon_rad) * ntiles);
			
			return point;
		}
		
		return function(obj, lat_lng, zoom)
		{
			if(!obj.__projection_px){ obj.__projection_px = []; }
			
			return obj.__projection_px[zoom] || (obj.__projection_px[zoom] = projection(lat_lng, zoom));
		};
	}());
	
	
	// ======= Google Maps Functions =======
	
	MAP.MarkerClusterGroup.prototype.draw = function(){};
	
	MAP.MarkerClusterGroup.prototype.onAdd = function()
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
		this._needsRemoving_i = {};
		
		
		// Remember the current zoom level and bounds
		this._zoom = this.map.getZoom();
		this._currentShownBounds = this._getExpandedVisibleBounds();
		
		// TODO: move this in spiderify.js with bind and call 
		if(this._spiderfierOnAdd){ this._spiderfierOnAdd(); }
		
		this._bindEvents();
		
		// Actually add our markers to the map:
		var layers = this._needsClustering;
		this._needsClustering = [];
		this._needsClustering_i = {};
		this.addLayers(layers);
	};
	
	MAP.MarkerClusterGroup.prototype.onRemove = function(map)
	{
		this._unbindEvents();
		
		// In case we are in a cluster animation
		// this._map._mapPane.className = this._map._mapPane.className.replace(' leaflet-cluster-anim', '');
		
		// if (this._spiderfierOnRemove) { //TODO FIXME: Not sure how to have spiderfier add something on here nicely
		// 	this._spiderfierOnRemove();
		// }
		
		// Clean up all the layers we added to the map
		this._featureGroup.clearLayers();
	};
	
	
	
	// ======= Signle Layer Functions =======
	
	MAP.MarkerClusterGroup.prototype.hasLayer = function(layer)
	{
		if(!layer){ return false; }
		
		if(layer.__parent && layer.__parent._group === this) return true;
		
		// console.log(this._needsClustering_i);
		if(layer.__stamp_id in this._needsClustering_i){ return true; }
		if(layer.__stamp_id in this._needsRemoving_i){ return false; }
		
		// return !!(layer.__parent && layer.__parent._group === this); // || this._nonPointGroup.hasLayer(layer);
		
		return false;
	};
	
	MAP.MarkerClusterGroup.prototype.addLayer = function(layer)
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
			this._needsClustering_i[layer.__stamp_id] = this._needsClustering.push(layer) - 1;
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
	
	MAP.MarkerClusterGroup.prototype.removeLayer = function(layer)
	{
		// if (layer instanceof L.LayerGroup)
		// {
		// 	var array = [];
		// 	for (var i in layer._layers) {
		// 		array.push(layer._layers[i]);
		// 	}
		// 	return this.removeLayers(array);
		// }
		
		// Non point layers
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
	
	MAP.MarkerClusterGroup.prototype.addLayers = function(layersArray)
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
			// console.log('has map, layers: ' + layersArray.length);
			var offset = 0, started = (new Date()).getTime();
			
			var process = MAP.bind(function()
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
					MAP.stamp(m)
					
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
					this._topClusterLevel._recalculateBounds();
					this._topClusterLevel._recursivelyAddChildrenToMap(null, this._zoom, this._currentShownBounds);
					
					// Update the icons of all those visible clusters that were affected
					fg.eachLayer(function(c)
					{
						if(c._is_cluster && c._iconNeedsUpdate){ c._updateIcon(); }
					});
				}
				else
				{
					setTimeout(process, chunkDelay);
				}
			}, this);
			
			process();
		}
		else
		{
			newMarkers = [];
			var length = this._needsClustering.length;
			
			for(i = 0, l = layersArray.length; i < l; i++)
			{
				m = layersArray[i];
				MAP.stamp(m)
				
				if(this.hasLayer(m)){ continue; }
				
				this._needsClustering_i[m.__stamp_id] = length + newMarkers.push(m) - 1;
			}
			
			this._needsClustering = this._needsClustering.concat(newMarkers);
		}
		
		return this;
	};
	
	MAP.MarkerClusterGroup.prototype.removeLayers = function(layersArray)
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
	
		// return this;
	};
	
	MAP.MarkerClusterGroup.prototype.clearLayers = function()
	{
		//If we aren't on the map (yet), blow away the markers we know of
		if(!this.map)
		{
			this._needsClustering = [];
			this._needsClustering_i = {};
			
			delete this._gridClusters;
			delete this._gridUnclustered;
		}
		
		if(this._noanimationUnspiderfy)
		{
			this._noanimationUnspiderfy();
		}
		
		//Remove all the visible layers
		this._featureGroup.clearLayers();
		// this._nonPointGroup.clearLayers();
		
		
		if(this._topClusterLevel)
		{
			var markers = this._topClusterLevel.getAllChildMarkers();
			for(i = markers.length - 1; i >= 0; i--)
			{
				delete markers[i].__parent;
			}
		}
		
		if(this.map)
		{
			//Reset _topClusterLevel and the DistanceGrids
			this._generateInitialClusters();
		}
		
		// return this;
	};
	
	
	// ======= Special Layers Functions =======
	
	// Zoom: Zoom to start adding at (Pass this._maxZoom to start at the bottom)
	MAP.MarkerClusterGroup.prototype._addLayer = function (layer, zoom)
	{
		var	markerPoint, closest, z
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
			markerPoint = this.ll2px(layer, layer.position, zoom); // calculate pixel position
			
			// Try find a cluster close by
			if(closest = gridClusters[zoom].getNearObject(markerPoint))
			{
				closest._addChild(layer);
				layer.__parent = closest;
				
				return;
			}
			
			//Try find a marker close by to form a new cluster with
			if(closest = gridUnclustered[zoom].getNearObject(markerPoint))
			{
				var parent = closest.__parent;
				if(parent){ this._removeLayer(closest, false); }
				
				//Create new cluster with these 2 in it
				var newCluster = new MAP.MarkerCluster(this, zoom, closest, layer);
				gridClusters[zoom].addObject(newCluster, this.ll2px(newCluster, newCluster._cPosition, zoom));
				closest.__parent = newCluster;
				layer.__parent = newCluster;
				
				//First create any new intermediate parent clusters that doesn't exist
				var lastParent = newCluster;
				for(z = zoom - 1; z > parent._zoom; z--)
				{
					lastParent = new MAP.MarkerCluster(this, z, lastParent);
					gridClusters[z].addObject(lastParent, this.ll2px(closest, closest.position, z));
				}
				parent._addChild(lastParent);
				
				//Remove closest from this zoom level and any above that it is in, replace with newCluster
				for(z = zoom; z >= 0; z--)
				{
					if(!gridUnclustered[z].removeObject(closest, this.ll2px(closest, closest.position, z))){ break; }
				}
				
				return;
			}
			
			//Didn't manage to cluster in at this zoom, record it as a marker here and continue upwards
			gridUnclustered[zoom].addObject(layer, markerPoint);
		}
		
		//Didn't get in anything, add us to the top
		this._topClusterLevel._addChild(layer);
		layer.__parent = this._topClusterLevel;
	};
	
	MAP.MarkerClusterGroup.prototype._removeLayer = function(marker, removeFromDistanceGrid, dontUpdateMap)
	{
		var	gridClusters	= this._gridClusters,
			gridUnclustered	= this._gridUnclustered,
			fg				= this._featureGroup
		;
		
		//Remove the marker from distance clusters it might be in
		if(removeFromDistanceGrid)
		{
			for(var z = this._maxZoom; z >= 0; z--)
			{
				if(!gridUnclustered[z].removeObject(marker, this.ll2px(marker, marker.position, z))){ break; }
			}
		}
		
		//Work our way up the clusters removing them as we go if required
		var	i, otherMarker
		,	cluster		= marker.__parent
		,	markers		= cluster._markers
		,	markers_i	= cluster._markers_i
		,	s			= marker.__stamp_id
		;
		
		//Remove the marker from the immediate parents marker list
		// this._arraySplice(markers, marker);
		if((i = markers_i[s]) > -1)
		{
			markers.splice(i, 1);
			delete markers_i[s];
			
			for(s in markers_i){ if(markers_i[s] > i) markers_i[s]--; }
		}
		
		while(cluster && cluster._zoom >= 0)
		{
			cluster._childCount--;
			
			if(removeFromDistanceGrid && cluster._childCount <= 1) //Cluster no longer required
			{
				//We need to push the other marker up to the parent
				otherMarker = cluster._markers[0] === marker ? cluster._markers[1] : cluster._markers[0];
				
				//Update distance grid
				gridClusters[cluster._zoom].removeObject(cluster, this.ll2px(cluster, cluster._cPosition, cluster._zoom));
				gridUnclustered[cluster._zoom].addObject(otherMarker, this.ll2px(otherMarker, otherMarker.position, cluster._zoom));
				
				//Move otherMarker up to parent
				// this._arraySplice(cluster.__parent._childClusters, cluster);
				if((i = cluster.__parent._childClusters.indexOf(cluster)) > -1){ cluster.__parent._childClusters.splice(i, 1); }
				cluster.__parent._markers_i[otherMarker.__stamp_id] = cluster.__parent._markers.push(otherMarker) - 1;
				otherMarker.__parent = cluster.__parent;
				
				if(cluster._icon)
				{
					//Cluster is currently on the map, need to put the marker on the map instead
					fg.removeLayer(cluster);
					if(!dontUpdateMap){ fg.addLayer(otherMarker); }
				}
			}
			// else
			// {
			// 	// cluster._recalculateBounds();
			// 	// if(!dontUpdateMap || !cluster._icon){ cluster._updateIcon(); }
			// }
			
			cluster = cluster.__parent;
		}
		
		delete marker.__parent;
	};
	
	
	// ======= Event Functions =======
	
	MAP.MarkerClusterGroup.prototype._bindEvents = function()
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
	
	MAP.MarkerClusterGroup.prototype._unbindEvents = function()
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
	
	
	MAP.MarkerClusterGroup.prototype._zoomEnd = function()
	{
		//May have been removed from the map by a zoomEnd handler
		if(!this._topClusterLevel){ return; }
		
		this._mergeSplitClusters();
		
		this._zoom = this.map.getZoom();
		this._currentShownBounds = this._getExpandedVisibleBounds();
	};
	
	MAP.MarkerClusterGroup.prototype._moveEnd = function()
	{
		if(this._inZoomAnimation){ return; }
		
		var newBounds = this._getExpandedVisibleBounds();
		
		this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, this._zoom, newBounds);
		this._topClusterLevel._recursivelyAddChildrenToMap(null, this.map.getZoom(), newBounds);
		
		this._currentShownBounds = newBounds;
	};
	
	
	// ======= Misc Functions ======
	
	// Gets the maps visible bounds expanded in each direction by the size of the screen (so the user cannot see an area we do not cover in one pan)
	MAP.MarkerClusterGroup.prototype._getExpandedVisibleBounds = function()
	{
		// if(!this.options.removeOutsideVisibleBounds){ return this.map.getBounds(); }
		
		var	bounds	= this.map.getBounds()
		,	sw		= bounds.getSouthWest()
		,	ne		= bounds.getNorthEast()
		,	latDiff	= Math.abs(sw.lat() - ne.lat()) // L.Browser.mobile ? 0 : Math.abs(sw.lat - ne.lat)
		,	lngDiff	= Math.abs(sw.lng() - ne.lng()) // L.Browser.mobile ? 0 : Math.abs(sw.lng - ne.lng)
		;
		
		return new GM.LatLngBounds(new GM.LatLng(sw.lat() - latDiff, sw.lng() - lngDiff, true), new GM.LatLng(ne.lat() + latDiff, ne.lng() + lngDiff, true));
	};
	
	MAP.MarkerClusterGroup.prototype._generateInitialClusters = function()
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
			this._gridClusters[zoom] = new MAP.DistanceGrid(radiusFn(zoom));
			this._gridUnclustered[zoom] = new MAP.DistanceGrid(radiusFn(zoom));
		}
		
		this._topClusterLevel = new MAP.MarkerCluster(this, -1);
	};
	
	// Merge and split any existing clusters that are too big or small
	MAP.MarkerClusterGroup.prototype._mergeSplitClusters = function()
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
			this._moveEnd();
		}
	};
	
	MAP.MarkerClusterGroup.prototype._processQueue = function()
	{
		for (var i = 0; i < this._queue.length; i++){ this._queue[i].call(this); }
		this._queue.length = 0;
		clearTimeout(this._queueTimeout);
		this._queueTimeout = null;
	};
	
	
	MAP.MarkerClusterGroup.prototype.getFingerprint = function()
	{
		var	i
		,	fingerprint	= []
		,	layers		= this._featureGroup.layers
		,	bounds		= this.map.getBounds()
		;
		
		for(i = layers.length - 1; i >= 0; --i)
		{
			if(bounds.contains(layers[i].position))
			{
				fingerprint.push(layers[i].__stamp_id);
			}
		}
		
		return fingerprint.join();
	};
	
	
	// ======= Animations Functions ======
	
	if(MAP.TRANSITIONS)
	{
		// This will look a lot better if zoomin/out animation is somehow disabled. 
		// 		Though there is no way to do this currently and there is a jumping-like effect
		// https://code.google.com/p/gmaps-api-issues/issues/detail?id=3397
		// https://code.google.com/p/gmaps-api-issues/issues/detail?id=3033
		// Also AFAIK there is currently no way to use transition for makrer position
		
		console.log('transitions');
		
		// Enqueue code to fire after the marker expand/contract has happened
		MAP.MarkerClusterGroup.prototype._enqueue = function(fn)
		{
			this._queue.push(fn);
			if(!this._queueTimeout){ this._queueTimeout = setTimeout(MAP.bind(this._processQueue, this), 300); }
		};
		
		// Force a browser layout of stuff in the map
		// Should apply the current opacity and location to all elements so we can update them again for an animation
		MAP.MarkerClusterGroup.prototype._forceLayout = function()
		{
			//In my testing this works, infact offsetWidth of any element seems to work.
			//Could loop all this._layers and do this for each _icon if it stops working
			
			// TODO do we need this
			// L.Util.falseFn(document.body.offsetWidth);
		};
		
		MAP.MarkerClusterGroup.prototype._animationStart = function()
		{
			if(this.map){ this.map.getDiv().className += ' cluster-anim'; }
			this._inZoomAnimation++;
		};
		
		MAP.MarkerClusterGroup.prototype._animationEnd = function()
		{
			if(this.map){ this.map.getDiv().className = this.map.getDiv().className.replace(/ cluster-anim/g, ''); }
			
			this._inZoomAnimation--;
			// this.fire('animationend');
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomIn = function(previousZoomLevel, newZoomLevel)
		{
			var	i
			,	bounds	= this._getExpandedVisibleBounds()
			,	fg		= this._featureGroup
			;
			
			//Add all children of current clusters to map and remove those clusters from map
			this._topClusterLevel._recursively(bounds, previousZoomLevel, 0, function(c)
			{
				var	m
				,	startPos	= c.position
				,	markers		= c._markers
				;
				
				if(!bounds.contains(startPos)){ startPos = null; }
				
				if(c._isSingleParent() && previousZoomLevel + 1 === newZoomLevel) // Immediately add the new child and remove us
				{
					fg.removeLayer(c);
					c._recursivelyAddChildrenToMap(null, newZoomLevel, bounds);
				}
				else
				{
					//Fade out old cluster
					c.setOpacity(0);
					c._recursivelyAddChildrenToMap(startPos, newZoomLevel, bounds);
				}
				
				//Remove all markers that aren't visible any more
				//TODO: Do we actually need to do this on the higher levels too?
				for(i = markers.length - 1; i >= 0; i--)
				{
					m = markers[i];
					
					if(!bounds.contains(m.position)){ fg.removeLayer(m); }
				}
			});
			
			// this._forceLayout();
			
			// Update opacities
			this._topClusterLevel._recursivelyBecomeVisible(bounds, newZoomLevel);
			
			// TODO Maybe? Update markers in _recursivelyBecomeVisible
			fg.eachLayer(function(n)
			{
				if(!n._is_cluster && n.map){ n.setOpacity(1); }
			});
			
			// update the positions of the just added clusters/markers
			this._topClusterLevel._recursively(bounds, previousZoomLevel, newZoomLevel, function(c)
			{
				c._recursivelyRestoreChildPositions(newZoomLevel);
			});
			
			// Remove the old clusters and close the zoom animation
			this._enqueue(function()
			{
				//update the positions of the just added clusters/markers
				this._topClusterLevel._recursively(bounds, previousZoomLevel, 0, function(c)
				{
					c.setOpacity(1);
					fg.removeLayer(c);
				});
				
				this._animationEnd();
			});
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomOut = function(previousZoomLevel, newZoomLevel)
		{
			setTimeout(MAP.bind(function()
			{
				this._animationZoomOutSingle(this._topClusterLevel, previousZoomLevel - 1, newZoomLevel);
				this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel, this._getExpandedVisibleBounds());
				this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
			}, this), 300);
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomOutSingle = function(cluster, previousZoomLevel, newZoomLevel)
		{
			var me = this, bounds = this._getExpandedVisibleBounds();
			
			// Animate all of the markers in the clusters to move to their cluster center point
			cluster._recursivelyAnimateChildrenInAndAddSelfToMap(bounds, previousZoomLevel + 1, newZoomLevel);
			
			// Update the opacity (If we immediately set it they won't animate)
			// this._forceLayout();
			cluster._recursivelyBecomeVisible(bounds, newZoomLevel);
			
			// TODO: Maybe use the transition timing stuff to make this more reliable
			// When the animations are done, tidy up
			this._enqueue(function()
			{
				// This cluster stopped being a cluster before the timeout fired
				if(cluster._childCount === 1)
				{
					var m = cluster._markers[0];
					//If we were in a cluster animation at the time then the opacity and position of our child could be wrong now, so fix it
					m.setPosition(m.position);
					if (m.setOpacity){ m.setOpacity(1); }
				}
				else
				{
					cluster._recursively(bounds, newZoomLevel, 0, function(c){ c._recursivelyRemoveChildrenFromMap(bounds, previousZoomLevel + 1); });
				}
				
				me._animationEnd();
			});
		};
		
		MAP.MarkerClusterGroup.prototype._animationAddLayer = function(layer, newCluster)
		{
			var me = this, fg = this._featureGroup;
			
			fg.addLayer(layer);
			if(newCluster !== layer)
			{
				if(newCluster._childCount > 2) // Was already a cluster
				{
					newCluster._updateIcon();
					// this._forceLayout();
					this._animationStart();
					
					layer.setPosition(this.getProjection().fromLatLngToDivPixel(newCluster.position));
					layer.setOpacity(0);
					
					this._enqueue(function()
					{
						fg.removeLayer(layer);
						layer.setOpacity(1);
						me._animationEnd();
					});
				}
				else //Just became a cluster
				{
					// this._forceLayout();
					
					me._animationStart();
					me._animationZoomOutSingle(newCluster, this.map.getMaxZoom(), this.map.getZoom());
				}
			}
		};
	}
	else
	{
		MAP.MarkerClusterGroup.prototype._animationStart = function()
		{
			//Do nothing...
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomIn = function(previousZoomLevel, newZoomLevel)
		{
			this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel);
			this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
			
			// We didn't actually animate, but we use this event to mean "clustering animations have finished"
			// this.fire('animationend');
		};
		
		MAP.MarkerClusterGroup.prototype._animationZoomOut = function(previousZoomLevel, newZoomLevel)
		{
			this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel);
			this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
			
			// We didn't actually animate, but we use this event to mean "clustering animations have finished"
			// this.fire('animationend');
		};
		
		MAP.MarkerClusterGroup.prototype._animationAddLayer = function(layer, newCluster)
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
}());
(function()
{
	var	GM = google.maps
	,	GE = GM.event
	;
	
	MAP.MarkerCluster = function(group, zoom, a, b)
	{
		this._is_cluster = true;
		MAP.stamp(this)
		
		// extend(MarkerCluster, GM.OverlayView);
		
		this._group				= group;
		this._zoom				= zoom;
		
		this._markers			= [];
		this._markers_i			= {};
		this._childClusters		= [];
		this._childClusters_i	= {};
		this._childCount		= 0;
		this._iconNeedsUpdate	= true;
		
		this._bounds			= new GM.LatLngBounds();
		
		this._div				= null;
		this._div_count			= null;
		
		if(a){ this._addChild(a); this.setPosition(this._cPosition = this._wPosition = a.position); }
		if(b){ this._addChild(b); }
	};
	
	MAP.MarkerCluster.prototype = new GM.OverlayView();
	
	
	// ======= Google Maps Functions =======
	
	MAP.MarkerCluster.prototype.setPosition = function(pos)
	{
		this.position = pos;
		
		if(this.map && this._div)
		{
			pos = this.getProjection().fromLatLngToDivPixel(this.position);
			this._div.style.left	= pos.x + 'px';
			this._div.style.top		= pos.y + 'px';
			// this._div.style.transform = 'translate(' + pos.x + 'px, ' + pos.y + 'px)';
		}
	};
	
	MAP.MarkerCluster.prototype.draw = function()
	{
		this.setPosition(this.position);
	};
	
	MAP.MarkerCluster.prototype.onRemove = function()
	{
		this._div.parentNode.removeChild(this._div);
		// this._div = null;
	};
	
	MAP.MarkerCluster.prototype.onAdd = function()
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
	
	
	MAP.MarkerCluster.prototype._addChild = function(new1, isNotificationFromChild)
	{
		this._iconNeedsUpdate = true;
		// this._expandBounds(new1, isNotificationFromChild);
		
		if(new1._is_cluster)
		{
			if(!isNotificationFromChild)
			{
				this._childClusters_i[new1.__stamp_id] = this._childClusters.push(new1) - 1;
				new1.__parent = this;
			}
			
			this._childCount += new1._childCount;
		}
		else
		{
			if(!isNotificationFromChild)
			{
				this._markers_i[new1.__stamp_id] = this._markers.push(new1) - 1;
			}
			
			this._childCount++;
		}
		
		if(this.__parent){ this.__parent._addChild(new1, true); }
	};
	
	//Expand our bounds and tell our parent to
	MAP.MarkerCluster.prototype._expandBounds = function(marker)
	{
		var lat, lng, addedCount, addedPosition = marker._wPosition || marker.position;
		
		// console.log(marker, addedPosition);
		if(marker._is_cluster)
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
		
		this.setPosition(this._wPosition = addedPosition);
	};
	
	// This is not needed
	MAP.MarkerCluster.prototype.getChildCount = function(){ return this._childCount; };
	
	MAP.MarkerCluster.prototype.getAllChildMarkers = function()
	{
		var i, storageArray = this._markers.slice();
		
		// for(var j = this._markers.length - 1; j >= 0; j--)
		// {
		// 	storageArray.push(this._markers[j]);
		// }
		
		for(i = this._childClusters.length - 1; i >= 0; i--)
		{
			storageArray.concat(this._childClusters[i].getAllChildMarkers(storageArray));
		}
		
		return storageArray;
	};
	
	MAP.MarkerCluster.prototype._recursivelyAddChildrenToMap = function(startPos, zoomLevel, bounds)
	{
		this._recursively(bounds, -1, zoomLevel, function(c)
		{
			if(zoomLevel === c._zoom){ return; }
			
			//Add our child markers at startPos (so they can be animated out)
			for(var nm, i = c._markers.length - 1; i >= 0; i--)
			{
				nm = c._markers[i];
				
				if(!bounds.contains(nm.position)){ continue; }
				
				// console.log(startPos);
				if(startPos)
				{
					nm._backupPosition = nm.position;
					
					nm.setPosition(startPos);
					if(nm.setOpacity){ nm.setOpacity(0); }
				}
				
				// console.log(nm);
				c._group._featureGroup.addLayer(nm);
			}
		}, function(c){ c._addToMap(startPos); });
	};
	
	//exceptBounds: If set, don't remove any markers/clusters in it
	MAP.MarkerCluster.prototype._recursivelyRemoveChildrenFromMap = function(previousBounds, zoomLevel, exceptBounds)
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
						if(m.setOpacity){ m.setOpacity(1); }
					}
				}
			},
			function(c)
			{
				//Remove child clusters at just the bottom level
				for(i = c._childClusters.length - 1; i >= 0; i--)
				{
					m = c._childClusters[i];
					if(!exceptBounds || !exceptBounds.contains(m.position))
					{
						c._group._featureGroup.removeLayer(m);
						if(m.setOpacity){ m.setOpacity(1); }
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
	MAP.MarkerCluster.prototype._recursively = function(boundsToApplyTo, zoomLevelToStart, zoomLevelToStop, runAtEveryLevel, runAtBottomLevel)
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
	
	MAP.MarkerCluster.prototype._addToMap = function(startPos)
	{
		if(startPos)
		{
			this._backupPosition = this.position;
			this.setPosition(startPos);
		}
		
		// this.setMap(this._group.map)
		// console.log(this._group.map);
		this._group._featureGroup.addLayer(this);
	};
	
	MAP.MarkerCluster.prototype._recalculateBounds = function()
	{
		var i, x, sw, ne
		,	markers		= this._markers
		,	clusters	= this._childClusters
		;
		
		if(markers.length === 0 && clusters.length === 0){ return; }
		
		for(i = clusters.length - 1; i >= 0; i--)
		{
			clusters[i]._recalculateBounds();
		}
		
		var m		= (markers[0] || clusters[0]).position
		,	min_lat = m.lat()
		,	min_lng = m.lng()
		,	max_lat = m.lat()
		,	max_lng = m.lng()
		,	avg_lat = 0
		,	avg_lng = 0
		,	avg_cnt	= markers.length
		;
		
		this._cPosition = this._wPosition = m;
		
		for(i = markers.length - 1; i >= 0; i--)
		{
			m = markers[i].position;
			
			x = m.lat();
			avg_lat += x;
			if(x < min_lat){ min_lat = x; } else if(x > max_lat){ max_lat = x; }
			
			x = m.lng();
			avg_lng += x;
			if(x < min_lng){ min_lng = x; } else if(x > max_lng){ max_lng = x; }
		}
		
		for(i = clusters.length - 1; i >= 0; i--)
		{
			m = clusters[i];
			
			x = m._wPosition;
			avg_cnt += m._childCount;
			avg_lat += x.lat() * m._childCount;
			avg_lng += x.lng() * m._childCount;
			
			m = m._bounds;
			sw = m.getSouthWest();
			ne = m.getNorthEast();
			x = sw.lat(); if(x < min_lat){ min_lat = x; }
			x = sw.lng(); if(x < min_lng){ min_lng = x; }
			x = ne.lat(); if(x > max_lat){ max_lat = x; }
			x = ne.lng(); if(x > max_lng){ max_lng = x; }
		}
		
		this._bounds = new GM.LatLngBounds(new GM.LatLng(min_lat, min_lng), new GM.LatLng(max_lat, max_lng));
		
		if(avg_cnt)
		{
			// console.log(avg_cnt, avg_lat/avg_cnt, this._wPosition.lat(), avg_lng/avg_cnt, this._wPosition.lng());
			this.setPosition(this._wPosition = new GM.LatLng(avg_lat/avg_cnt, avg_lng/avg_cnt));
		}
		else
		{
			// console.log(avg_cnt, avg_lat, this._wPosition.lat(), avg_lng, this._wPosition.lng());
			this.setPosition(this._wPosition = new GM.LatLng(avg_lat, avg_lng));
		}
	};
	
	
	// EVENT
	MAP.MarkerCluster.prototype._zoomOrSpiderfy = function(ev)
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
	
	MAP.MarkerCluster.prototype.zoomToBounds = function()
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
		// 	this._group._map.setView(this._position, zoom);
		// }
		// else if(boundsZoom <= mapZoom) //If fitBounds wouldn't zoom us down, zoom us down instead
		// {
		// 	this._group._map.setView(this._position, mapZoom + 1);
		// }
		// else
		// {
			map.fitBounds(this._bounds);
		// }
	};
	
	MAP.MarkerCluster.prototype._updateIcon = function()
	{
		if(!this._div){ return null; }
		
		this._div.className = 'cluster cluster-size-' + ('' + this._childCount).length;
		this._div_count.innerHTML = this._childCount;
		
		this._iconNeedsUpdate = false;
	};
	
	MAP.MarkerCluster.prototype.setOpacity = function(o)
	{
		if(!this._div){ return null; }
		
		this._div.style.opacity = o;
	};
	
	if(MAP.TRANSITIONS)
	{
		//Returns true if we are the parent of only one cluster and that cluster is the same as us
		MAP.MarkerCluster.prototype._isSingleParent = function()
		{
			//Don't need to check this._markers as the rest won't work if there are any
			return this._childClusters.length > 0 && this._childClusters[0]._childCount === this._childCount;
		};
		
		MAP.MarkerCluster.prototype._recursivelyAnimateChildrenInAndAddSelfToMap = function(bounds, previousZoomLevel, newZoomLevel)
		{
			this._recursively(bounds, newZoomLevel, 0, function(c)
			{
				// console.log(c._group.getProjection().fromLatLngToDivPixel(c.position));
				c._recursivelyAnimateChildrenIn(bounds, c.position, previousZoomLevel);
				
				//TODO: depthToAnimateIn affects _isSingleParent, if there is a multizoom we may/may not be.
				//As a hack we only do a animation free zoom on a single level zoom, if someone does multiple levels then we always animate
				if(c._isSingleParent() && previousZoomLevel - 1 === newZoomLevel)
				{
					c._recursivelyRemoveChildrenFromMap(bounds, previousZoomLevel); //Immediately remove our children as we are replacing them. TODO previousBounds not bounds
					c.setOpacity(1);
				}
				else
				{
					c.setOpacity(0);
				}
				
				// console.log(c);
				c._addToMap();
			});
		};
		
		MAP.MarkerCluster.prototype._recursivelyAnimateChildrenIn = function(bounds, center, maxZoom)
		{
			this._recursively
			(
				bounds, 0, maxZoom - 1,
				function(c)
				{
					var i, m, markers = c._markers;
					
					for(i = markers.length - 1; i >= 0; i--)
					{
						m = markers[i];
						if(m.map)
						{
							m.setPosition(center);
							m.setOpacity(0);
						}
					}
				},
				function(c)
				{
					var j, cm, childClusters = c._childClusters;
					
					for(j = childClusters.length - 1; j >= 0; j--)
					{
						cm = childClusters[j];
						if(cm.map)
						{
							cm.setPosition(center);
							cm.setOpacity(0);
						}
					}
				}
			);
		};
		
		MAP.MarkerCluster.prototype._recursivelyBecomeVisible = function(bounds, zoomLevel)
		{
			this._recursively(bounds, 0, zoomLevel, null, function(c){ c.setOpacity(1); });
		};
		
		MAP.MarkerCluster.prototype._recursivelyRestoreChildPositions = function(zoomLevel)
		{
			var nm, i;
			
			//Fix positions of child markers
			for(i = this._markers.length - 1; i >= 0; i--)
			{
				nm = this._markers[i];
				if(nm._backupPosition)
				{
					nm.setPosition(nm._backupPosition);
					delete nm._backupPosition;
				}
			}
			
			//Reposition child clusters
			if(zoomLevel - 1 === this._zoom)
			{
				for(i = this._childClusters.length - 1; i >= 0; i--){ this._childClusters[i]._restorePosition(); }
			}
			else
			{
				for(i = this._childClusters.length - 1; i >= 0; i--){ this._childClusters[i]._recursivelyRestoreChildPositions(zoomLevel); }
			}
		};
		
		MAP.MarkerCluster.prototype._restorePosition = function()
		{
			if(this._backupPosition)
			{
				this.setPosition(this._backupPosition);
				delete this._backupPosition;
			}
		};
	}
}());

MAP.DistanceGrid = function(cellSize)
{
	this._cellSize		= cellSize;
	this._sqCellSize	= cellSize * cellSize;
	this._grid			= {};
	this._objectPoint	= {};
};

MAP.DistanceGrid.prototype.addObject = function(obj, point)
{
	var	row, cell
	,	p		= this._getCoords(point)
	,	_x		= p._x
	,	_y		= p._y
	,	grid	= this._grid
	;
	
	if(_y in grid)
	{
		row = grid[_y];
		cell = _x in row ? row[_x] : (row[_x] = []);
	}
	else
	{
		row = grid[_y] = {};
		cell = row[_x] = [];
	}
	
	point._cell = cell;
	this._objectPoint[obj.__stamp_id] = point;
	
	cell.push(obj);
};

// MAP.DistanceGrid.prototype.updateObject = function(obj, point)
// {
// 	this.removeObject(obj);
// 	this.addObject(obj, point);
// };

//Returns true if the object was found
MAP.DistanceGrid.prototype.removeObject = function(obj, point)
{
	if(!('_cell' in point)){ return; }
	
	var	i, cell = point._cell;
	
	// console.log(this._objectPoint[obj.__stamp_id]);
	
	if((i = cell.indexOf(obj)) > -1)
	{
		delete this._objectPoint[obj.__stamp_id];
		delete point._cell;
		
		cell.splice(i, 1);
		
		if(cell.length === 1)
		{
			delete this._grid[point._y];
		}
		
		return true;
	}
};

MAP.DistanceGrid.prototype.getNearObject = function(point)
{
	var i, j, k, row, cell, len, obj, dist
	,	p				= this._getCoords(point)
	,	objectPoint		= this._objectPoint
	,	closestDistSq	= this._sqCellSize
	,	grid			= this._grid
	,	closest			= null
	;
	
	for(i = -1; i <= 1; i++)
	{
		if(row = grid[p._y + i])
		{
			for(j = -1; j <= 1; j++)
			{
				if(cell = row[p._x + j])
				{
					for(k = 0, len = cell.length; k < len; k++)
					{
						obj		= cell[k];
						dist	= this._sqDist(objectPoint[obj.__stamp_id], point);
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
};

MAP.DistanceGrid.prototype._getCoords = function(point)
{
	if(!point._x || !point._y)
	{
		point._x = Math.floor(point.x / this._cellSize);
		point._y = Math.floor(point.y / this._cellSize);
	}
	
	return point;
};

MAP.DistanceGrid.prototype._sqDist = function(p1, p2)
{
	var	dx = p2.x - p1.x
	,	dy = p2.y - p1.y
	;
	return dx * dx + dy * dy;
};

(function()
{
	//This code is 100% based on https://github.com/jawj/OverlappingMarkerSpiderfier-Leaflet
	//Huge thanks to jawj for implementing it first to make my job easy :-)
	
	var	GM = google.maps
	,	GE = GM.event
	;
	
	MAP.MarkerCluster.prototype.spiderfy = function()
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
	
	
	MAP.MarkerCluster.prototype.unspiderfy = function(zoomDetails)
	{
		if(this._group._inZoomAnimation){ return; }
		
		this._animationUnspiderfy(zoomDetails);
		this._group._spiderfied = null;
	};
	
	
	MAP.MarkerCluster.prototype._2PI					= Math.PI * 2;
	MAP.MarkerCluster.prototype._circleStartAngle		= Math.PI / 6;
	MAP.MarkerCluster.prototype._circleFootSeparation	= 23; // related to circumference of circle
	
	MAP.MarkerCluster.prototype._spiralFootSeparation	= 26; // related to size of spiral (experiment!)
	MAP.MarkerCluster.prototype._spiralLengthStart		= 11;
	MAP.MarkerCluster.prototype._spiralLengthFactor		= 4;
	
	// show spiral instead of circle from this marker count upwards.
	// 0 -> always spiral; Infinity -> always circle
	MAP.MarkerCluster.prototype._circleSpiralSwitchover	= 9;
	
	
	MAP.MarkerCluster.prototype._generatePointsCircle = function(count, centerPt)
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
	
	
	MAP.MarkerCluster.prototype._generatePointsSpiral = function(count, centerPt)
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
	
	/*
	if(MAP.TRANSITIONS)
	{
		MAP.MarkerCluster.prototype.SVG_ANIMATION = (function()
		{
			return document.createElementNS('http://www.w3.org/2000/svg', 'animate').toString().indexOf('SVGAnimate') > -1;
		}()),
		
		MAP.MarkerCluster.prototype._animationSpiderfy = function(childMarkers, positions)
		{
			var	i, m, leg, newPos
			,	me = this
			,	group			= this._group
			,	map				= group._map
			,	fg				= group._featureGroup
			,	thisLayerPos	= this.getProjection().fromLatLngToContainerPixel(this.position)
			;
			
			//Add markers to map hidden at our center point
			for(i = childMarkers.length - 1; i >= 0; i--)
			{
				m = childMarkers[i];
				
				// If it is a marker, add it now and we'll animate it out
				if(m.setOpacity)
				{
					// m.setZIndexOffset(1000000); //Make these appear on top of EVERYTHING
					m.setOpacity(0);
					
					fg.addLayer(m);
					
					m._setPosition(thisLayerPos);
				}
				else
				{
					// Vectors just get immediately added
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
				m._preSpiderfyLatlng = m.position;
				m.setLatLng(newPos);
				
				if (m.setOpacity) {
					m.setOpacity(1);
				}
				
				//Add Legs.
				leg = new L.Polyline([me.position, newPos], { weight: 1.5, color: '#222', opacity: initialLegOpacity });
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
			
			setTimeout(function()
			{
				group._animationEnd();
				group.fire('spiderfied');
			}, 200);
		},
		
		MAP.MarkerCluster.prototype._animationUnspiderfy = function(zoomDetails)
		{
			var group = this._group,
				map = group._map,
				fg = group._featureGroup,
				thisLayerPos = zoomDetails ? map._latLngToNewLayerPoint(this.position, zoomDetails.zoom, zoomDetails.center) : map.latLngToLayerPoint(this.position),
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
	}
	else
	{
	*/
		MAP.MarkerCluster.prototype._animationSpiderfy = function(childMarkers, positions)
		{
			var	i, m, leg, newPos,
				group	= this._group,
				map		= group.map,
				fg		= group._featureGroup
			;
			
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
		
		MAP.MarkerCluster.prototype._animationUnspiderfy = function()
		{
			var	m, i,
				group			= this._group,
				map				= group._map,
				fg				= group._featureGroup,
				childMarkers	= this.getAllChildMarkers()
			;
			
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
	// }
	
	
	
	
	
	// TODO get all spiderifying outside of MarkerCluster
	
	MAP.MarkerClusterGroup.prototype._spiderfied = null;
	
	MAP.MarkerClusterGroup.prototype._spiderfierOnAdd = function()
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
	
	MAP.MarkerClusterGroup.prototype._unspiderfy = function(zoomDetails)
	{
		if(this._spiderfied){ this._spiderfied.unspiderfy(zoomDetails); }
	};
	
	MAP.MarkerClusterGroup.prototype._noanimationUnspiderfy = function()
	{
		if(this._spiderfied){ this._spiderfied._animationUnspiderfy(); }
	};
	
	
	/*
	L.MarkerClusterGroup.include({
		_spiderfierOnRemove: function () {
			this._map.off('click', this._unspiderfyWrapper, this);
			this._map.off('zoomstart', this._unspiderfyZoomStart, this);
			this._map.off('zoomanim', this._unspiderfyZoomAnim, this);
			
			this._unspiderfy(); //Ensure that markers are back where they should be
		},
		
		
		//On zoom start we add a zoomanim handler so that we are guaranteed to be last (after markers are animated)
		//This means we can define the animation they do rather than Markers doing an animation to their actual location
		_unspiderfyZoomStart: function () {
			if (!this._map) { //May have been removed from the map by a zoomEnd handler
				return;
			}
			
			this._map.on('zoomanim', this._unspiderfyZoomAnim, this);
		},
		_unspiderfyZoomAnim: function (zoomDetails) {
			//Wait until the first zoomanim after the user has finished touch-zooming before running the animation
			if (L.DomUtil.hasClass(this._map._mapPane, 'leaflet-touching')) {
				return;
			}
	
			this._map.off('zoomanim', this._unspiderfyZoomAnim, this);
			this._unspiderfy(zoomDetails);
		},
		
		//If the given layer is currently being spiderfied then we unspiderfy it so it isn't on the map anymore etc
		_unspiderfyLayer: function (layer) {
			if (layer._spiderLeg) {
				this._featureGroup.removeLayer(layer);
	
				layer.setOpacity(1);
				//Position will be fixed up immediately in _animationUnspiderfy
				layer.setZIndexOffset(0);
	
				this._map.removeLayer(layer._spiderLeg);
				delete layer._spiderLeg;
			}
		}
	});
	*/
	
}());