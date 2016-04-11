'use strict';

var util = require('util');
var chalk = require('chalk');
var conf = require('./lib/conf.js');
var workflow = require('./lib/workflow.js');

module.exports = function (grunt) {

    grunt.registerTask('ec2-setup', 'Sets up port forwarding, installs `rsync`, `node`, and `pm2`, enqueues `ec2-nginx-configure`', function (name) {
        conf.init(grunt);

        if (arguments.length === 0) {
            grunt.fatal([
                'You should provide an instance name.',
                'e.g: ' + chalk.yellow('grunt ec2-setup:name')
            ].join('\n'));
        }

        // TODO rsync user, node user, nginx user?

        var done = this.async();
        var cert = conf('SRV_RSYNC_CERT');
        var latest = conf('SRV_RSYNC_LATEST');
        var versions = conf('SRV_VERSIONS');
        var platform = conf('PM2_PLATFORM');
        var pm2version = conf('PM2_VERSION');
        var nodeVersion = conf('NODE_VERSION');
        var steps = [[
            util.format('echo "configuring up %s instance..."', name)
        ],  [ // git
            'sudo add-apt-repository ppa:git-core/ppa -y',
            'sudo apt-get update',
            'sudo apt-get install git -y'
        ], [ // node.js & pm2
            'sudo apt-get install python-software-properties',
            'sudo add-apt-repository ppa:chris-lea/nginx-devel -y',
            'sudo apt-get update',
            'sudo apt-get install make g++ -y',
            'sudo curl -sL https://deb.nodesource.com/setup_5.x | sudo -E bash -',
            'sudo apt-get install -y nodejs',
            util.format('sudo npm install -g pm2@%s --unsafe-perm', pm2version),
            // Run pm2 startup so that the app re-starts on machine reboot
            util.format('sudo pm2 startup %s -u %s --hp /home/%s', platform, platform, platform),
        ],  [ // enable forwarding
          'cp /etc/sysctl.conf /tmp/',
          'echo "net.ipv4.ip_forward = 1" >> /tmp/sysctl.conf',
          'sudo cp /tmp/sysctl.conf /etc/',
          'sudo sysctl -p /etc/sysctl.conf'
        ], [ // forward port 80
          forwardPort(80, 8080)
        ], workflow.if_has('SSL_ENABLED', // forward port 443
          forwardPort(443, 8433)
        ), [ // rsync
          util.format('sudo mkdir -p %s', versions),
          util.format('sudo mkdir -p %s', cert),
          util.format('sudo chown ubuntu %s', cert),
          util.format('sudo mkdir -p %s', latest),
          util.format('sudo chown ubuntu %s', latest)
        ], workflow.if_has('SSL_ENABLED', { // send certificates
          rsync: {
            name: 'cert',
            local: conf('SSL_CERTIFICATE_DIRECTORY'),
            remote: conf('SRV_RSYNC_CERT'),
            dest: conf('SRV_CERT'),
            includes: [
              '*/',
              conf('SSL_CERTIFICATE'),
              conf('SSL_CERTIFICATE_KEY')
            ],
            excludes: ['*']
          }
        }), [ // iptables-persistent
          'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q iptables-persistent'
        ], workflow.if_has('PANDOC_ENABLED', // install pandoc
          installPandoc()
        )];

        function forwardPort(from, to) {
            return [
                util.format('sudo iptables -A PREROUTING -t nat -i eth0 -p tcp --dport %s -j REDIRECT --to-port %s', from, to),
                util.format('sudo iptables -A INPUT -p tcp -m tcp --sport %s -j ACCEPT', from),
                util.format('sudo iptables -A OUTPUT -p tcp -m tcp --dport %s -j ACCEPT', from),
                'sudo iptables-save'
            ];
        }

        function installPandoc() {
          return [
            'sudo apt-get install haskell-platform -y',
            'cabal update',
            'cabal install zip-archive',
            'cabal install pandoc'
          ];
        }


        workflow(steps, { name: name }, next);

        function next () {
            grunt.log.writeln('Enqueued task for %s configuration.', chalk.cyan('nginx'));
            grunt.task.run('ec2-nginx-configure:' + name);
            done();
        }
    });
};
