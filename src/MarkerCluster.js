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
		this._iconNeedsRecalc	= true;
		
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
		this._iconNeedsRecalc = true;
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
	// MAP.MarkerCluster.prototype._expandBounds = function(marker)
	// {
	// 	var lat, lng, addedCount, addedPosition = marker._wPosition || marker.position;
		
	// 	// console.log(marker, addedPosition);
	// 	if(marker._is_cluster)
	// 	{
	// 		// console.info(this._bounds, marker._bounds);
	// 		this._bounds.union(marker._bounds);
	// 		addedCount = marker._childCount;
	// 	}
	// 	else
	// 	{
	// 		this._bounds.extend(addedPosition);
	// 		// console.info(this._bounds);
	// 		addedCount = 1;
	// 	}
		
	// 	if(!this._cPosition)
	// 	{
	// 		// when clustering, take position of the first point as the cluster center
	// 		this._cPosition = marker._cPosition || addedPosition;
	// 	}
		
	// 	// when showing clusters, take weighted average of all points as cluster center
	// 	var totalCount = this._childCount + addedCount;
		
	// 	//Calculate weighted latlng for display
	// 	if(this._wPosition)
	// 	{
	// 		lat = (addedPosition.lat() * addedCount + this._wPosition.lat() * this._childCount) / totalCount;
	// 		lng = (addedPosition.lng() * addedCount + this._wPosition.lng() * this._childCount) / totalCount;
			
	// 		addedPosition = new GM.LatLng(lat, lng);
	// 	}
		
	// 	this.setPosition(this._wPosition = addedPosition);
	// };
	
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
		var x, sw, ne
		,	markers		= this._markers
		,	clusters	= this._childClusters
		;
		
		
		if(!this._iconNeedsRecalc || markers.length === 0 && clusters.length === 0){ return; }
		
		this._iconNeedsRecalc = true;
		
		for(var i = clusters.length - 1; i >= 0; i--)
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
		
		for(var i = markers.length - 1; i >= 0; i--)
		{
			m = markers[i].position;
			
			x = m.lat();
			avg_lat += x;
			if(x < min_lat){ min_lat = x; } else if(x > max_lat){ max_lat = x; }
			
			x = m.lng();
			avg_lng += x;
			if(x < min_lng){ min_lng = x; } else if(x > max_lng){ max_lng = x; }
		}
		
		for(var i = clusters.length - 1; i >= 0; i--)
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
		
		// if(m.__parent !== this._topClusterLevel)
		// TODO do not do for top it should be done after all recals outside of this in MarkerClusterGroup
		
		// if(this.__parent){ this.__parent._recalculateBounds(); }
		
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
