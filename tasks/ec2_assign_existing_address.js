'use strict';

var chalk = require('chalk');
var exec = require('./lib/exec.js');
var conf = require('./lib/conf.js');

module.exports = function(grunt){

    grunt.registerTask('ec2_assign_existing_address', function(id,ip){
        conf.init(grunt);

        if (arguments.length < 2) {
            grunt.fatal([
                'You should provide an instance id and the IP you want to assign to it.',
                'e.g: ' + chalk.yellow('grunt ec2_assign_existing_address:id:ip')
            ].join('\n'));
        }

        var done = this.async();

        grunt.log.writeln('Associating EC2 instance %s to IP %s', chalk.cyan(id), chalk.cyan(ip));

        exec('aws ec2 associate-address --instance-id %s --public-ip %s', [id, ip], done);
    });
};