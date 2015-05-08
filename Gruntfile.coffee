module.exports = (grunt)->
	grunt.initConfig
		pkg: grunt.file.readJSON 'package.json'
		
		concat:
			all:
				dest: 'dist/MarkerClusterGroup.js'
				src: [
					'src/copyright.js'
					'src/MarkerClusterGroupInit.js'
					'src/MarkerClusterGroup.js'
					'src/MarkerCluster.js'
					'src/DistanceGrid.js'
					'src/MarkerCluster.Spiderfier.js'
				]
		
		
		
		
		
		
		
		# sass:
		# 	dist:
		# 		options:
		# 			outputStyle: 'expanded'
				
		# 		files:
		# 			'styles/app.css': 'scss/app.scss'
		# 			'styles/embed.css': 'scss/embed.scss'
			
		# 	sourceMap:
		# 		options:
		# 			sourceComments	: 'map'
		# 			sourceMap		: 'app.css.map'
		# 		files:
		# 			'styles/app.css': 'scss/app.scss'
		
		# livescript:
		# 	options:
		# 		bare: yes
		# 		join: yes
			
		# 	src:
		# 		files:
		# 			'scripts/app/app.js'							: 'scripts/src/app.ls'
		# 			'scripts/app/support.js'						: 'scripts/src/support.ls'
		# 			'scripts/app/directives/hp-window-height.js'	: 'scripts/src/directives/hp-window-height.ls'
		# 			# 'scripts/compiled.js': [ 'scripts/src/*.ls' ]
		
		# watch:
		# 	styles:
		# 		files: [ 'scss/*.scss', 'scss/**/*.scss' ]
		# 		tasks: [ 'sass' ]
			
		# 	scripts:
		# 		files: [ 'scripts/src/*.ls', 'scripts/src/**/*.ls' ]
		# 		tasks: [ 'livescript' ]
			
		# 	livereload:
		# 		files: [ '*.html', '*.scss', 'js/**/*.{js,json}', 'css/*.css', 'img/**/*.{png,jpg,jpeg,gif,webp,svg}' ]
		# 		options:
		# 			livereload: yes
		
		# dataUri:
		# 	dist:
		# 		src	: [ 'styles/*.css' ]
		# 		dest: 'styles/'
		# 		options:
		# 			target		: [ 'images/*.*' ]
		# 			fixDirLevel	: yes
	
	grunt.registerTask 'default', [ 'concat' ]
	
	grunt.loadNpmTasks 'grunt-contrib-concat'
	
	return
