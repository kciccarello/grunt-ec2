'use strict';

var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var util = require('util');
var chalk = require('chalk');
var mustache = require('mustache');
var ssh = require('./lib/ssh.js');
var conf = require('./lib/conf.js');

module.exports = function(grunt){

    grunt.registerTask('ec2_setup', function(name){
        conf.init(grunt);

        if (arguments.length === 0) {
            grunt.fatal([
                'You should provide an instance name.',
                'e.g: ' + chalk.yellow('grunt ec2_setup:name')
            ].join('\n'));
        }

        function iif (value, commands) {
            return conf(value) ? commands : [];
        }

        // TODO rsync user, node user, nginx user?

        var done = this.async();
        var project = conf('PROJECT_ID');
        var tasks = [[
            util.format('echo "configuring up %s instance..."', name)
        ], [ // forward port 80
            forwardPort(80, 8080)
        ], iif('SSL_ENABLED', // forward port 443
            forwardPort(443, 8433)
        ), [ // rsync
            util.format('sudo mkdir -p /srv/rsync/%s/latest', project),
            util.format('sudo mkdir -p /srv/apps/%s/v', project),
            util.format('sudo chown ubuntu /srv/rsync/%s/latest', project)
        ], iif('NGINX_ENABLED', // nginx
            nginxConf()
        ), [ // node.js
            'sudo apt-get install python-software-properties',
            'sudo add-apt-repository ppa:chris-lea/node.js -y',
            'sudo apt-get update',
            'sudo apt-get install nodejs -y'
        ], [ // pm2
            'sudo apt-get install make g++ -y',
            'sudo npm install -g pm2',
            'sudo pm2 startup'
        ]];

        function forwardPort(from, to) {
            return [
                'cp /etc/sysctl.conf /tmp/',
                'echo "net.ipv4.ip_forward = 1" >> /tmp/sysctl.conf',
                'sudo cp /tmp/sysctl.conf /etc/',
                'sudo sysctl -p /etc/sysctl.conf',
                util.format('sudo iptables -A PREROUTING -t nat -i eth0 -p tcp --dport %s -j REDIRECT --to-port %s', from, to),
                util.format('sudo iptables -A INPUT -p tcp -m tcp --sport %s -j ACCEPT', from),
                util.format('sudo iptables -A OUTPUT -p tcp -m tcp --dport %s -j ACCEPT', from),
                'sudo iptables-save'
            ];
        }

        function nginxTemplate (name, where) {
            var remote = util.format('/srv/apps/%s/%s.conf', project, name);
            var file = path.resolve(__dirname, util.format('../cfg/%s.conf', name));
            var template = fs.readFileSync(file, { encoding: 'utf8' });
            var data = mustache.render(template, conf());
            var escaped = data
                .replace(/"/g, '\\"')
                .replace(/\$/g, '\\$');

            return [
                util.format('sudo touch %s', remote),
                util.format('sudo chown ubuntu %s', remote),
                util.format('sudo ln -sfn %s /etc/nginx/%s.conf', remote, where),
                util.format('echo "%s" > %s', escaped, remote)
            ];
        }

        function nginxConf () {
            return [
                'sudo add-apt-repository ppa:chris-lea/nginx-devel.js -y',
                'sudo apt-get update',
                'sudo apt-get install nginx nginx-common nginx-full -y',
                nginxTemplate('http', 'nginx'),
                nginxTemplate('server', 'sites-enabled/' + project),
                'sudo service nginx start || (cat /var/log/nginx/error.log && exit 1)'
            ];
        }

        var commands = _.flatten(tasks);
        ssh(commands, name, done);
    });
};