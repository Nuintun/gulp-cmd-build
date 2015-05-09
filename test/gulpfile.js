/**
 * Created by nuintun on 2015/5/5.
 */

'use strict';

var gulp = require('gulp');
var util = require('../lib/util');
var colors = util.colors;
var through = require('through2');
var transport = require('../lib/transport');
var include = require('../lib/include');

function listen(){
  return through.obj(function (file, encoding, done){
    if (file.isNull()) {
      // return empty file
      return done(null, file);
    }

    if (file.isStream()) {
      return callback(util.throwError('streaming not supported.'));
    }

    console.log('\n');
    console.log(colors.infoBold(file.path));
    console.log('\n');
    console.log(colors.verboseBold(JSON.stringify(file.package, null, 2)));
    console.log('\n');

    this.push(file);
    done();
  });
}

var alias = { 'class': 'base/class/1.2.0/class' };

gulp.task('default', function (){
  gulp.src('assets/js/**/*.*', { base: 'assets/js' })
    .pipe(include({ alias: alias }))
    //.pipe(listen())
    //.pipe(gulp.dest('dist/js'))
    .on('end', function (){
      console.log('  ---------------all transport end---------------');
    });

  //gulp.src('assets/css/**/*.*', { base: 'assets/css' })
  //  .pipe(include())
  //  .pipe(listen())
  //  //.pipe(gulp.dest('dist/css'))
  //  .on('end', function (){
  //    console.log('  ---------------all transport end---------------');
  //  });
});

gulp.task('watch', function (){
  gulp.watch('assets/js/**/*.*', function (e){
    if (e.type !== 'deleted') {
      return gulp.src(e.path, { base: 'assets/js' })
        .pipe(include({ alias: alias }))
        .pipe(listen())
        //.pipe(gulp.dest('dist/js'))
        .on('end', function (){
          console.log('  ---------------all transport end---------------');
        });
    }
  });

  gulp.watch('assets/css/**/*.*', function (e){
    if (e.type !== 'deleted') {
      return gulp.src(e.path, { base: 'assets/css' })
        .pipe(include())
        .pipe(listen())
        //.pipe(gulp.dest('dist/css'))
        .on('end', function (){
          console.log('  ---------------all transport end---------------');
        });
    }
  });
});