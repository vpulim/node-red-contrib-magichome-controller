var MagicHomeControl = require('magic-home').Control;
var events = require('events');

module.exports = function (RED) {
    function MagicHomeControlNode(config) {
        RED.nodes.createNode(this, config);

        class LampState extends events.EventEmitter {
            constructor() {
                super();

                this.C_ON = 'on';
                this.C_OFF = 'off';

                this._power = this.C_OFF;
                this._brightness = 0;
            }

            static normalizeRange(min, max, value, previousValue) {
                let normalizedValue;
                // given range has to be integers, value has to be finite

                if (!(Number.isInteger(min) && Number.isInteger(max) && isFinite(value))) {
                    return previousValue;
                }

                normalizedValue = parseInt(Math.min(max, Math.max(min, value)), 10);

                return normalizedValue;
            }

            set power(state) {
                // sanitize
                if (state == true || state == this.C_ON) {
                    this._power = this.C_ON;
                    this.emit('change', 'power');
                } else if (state == false || state == this.C_OFF) {
                    this._power = this.C_OFF;
                    this.emit('change', 'power');
                }
            }
            get power() {
                return this._power;
            }

            set brightness(value) {
                try {
                    this._brightness = this.constructor.normalizeRange(0, 100, value, this._brightness);
                    this.emit('change', 'brightness');
                } catch (error) {
                    node.error(error);
                }
            }
            get brightness() {
                return this._brightness;
            }

            set status(objLampState) {

                if (objLampState.power == true || objLampState.power == this.C_ON) {
                    this._power = this.C_ON;
                } else if (objLampState.power == false || objLampState.power == this.C_OFF) {
                    this._power = this.C_OFF;
                }

                let red = Math.round(objLampState.color.red / 255 * 100)
                this._brightness = this.constructor.normalizeRange(0, 100, red, this._brightness);

                this.emit('change', 'status');
            }
            get status() {
                let objStatus = {
                    power: this.power,
                    brightness: this.brightness
                };
                return objStatus;
            }

            compare(objLampState) {
                let compareFields = ['power', 'brightness'];
                let isEqual = true;

                if (!(objLampState instanceof LampState)) {
                    return true;
                }

                for (let args of compareFields) {
                    if (this[args] !== objLampState[args]) {
                        isEqual = false;
                        break;
                    }
                }

                return isEqual;

            }
        }

        // read config node
        let host;
        let lampName;

        this.server = RED.nodes.getNode(config.server);

        if (this.server) {
            host = this.server.host;
            lampName = this.server.name;
        }

        let internalState = new LampState();

        let node = this;
        let light = new MagicHomeControl(host, {
          set_color_magic_bytes: [0x01, 0x0f],
          wait_for_reply: false
        });

        function setState(value) {

            if (value === internalState.C_ON || value === true) {
                light.turnOn(function () {
                    queryLampState();
                });
            } else if (value === internalState.C_OFF || value === false) {
                light.turnOff(function () {
                    queryLampState();
                });
            }
        }

        function refreshStateIndicator(lampState) {
            if (lampState.power === lampState.C_ON) {
                node.status({
                    fill: 'yellow',
                    shape: 'dot',
                    text: 'brightness: ' + lampState.brightness + '%'
                });
            } else if (lampState.power === lampState.C_OFF) {
                node.status({
                    fill: 'gray',
                    shape: 'dot',
                    text: 'off'
                });
            } else {
                node.status({
                    fill: 'gray',
                    shape: 'ring',
                    text: 'unknown'
                });
            }
        }

        function setBrightness(level, speed = 100) {
          level = LampState.normalizeRange(0, 255, level, internalState.brightness);
          light.setBrightness(level, speed, queryLampState);
        }

        function queryLampState() {
            light.queryState(evaluateQueryResult);
        }

        function evaluateQueryResult(err, data) {
            // on/off state
            if (err !== null) {
                node.error('lamp \'' + lampName + '\' not reachable.');
                return;
            }

            let queryData = {
                power: data.on,
                color: data.color
            };
            internalState.status = queryData;
        }

        function sendStateMsg() {
            var msg = {payload:internalState.status};

            node.send(msg);
        }

        node.on('input', function name(msg) {
            // state on/off
            if (msg.payload.query !== undefined) {
                queryLampState();
            }

            if (msg.payload.power !== undefined) {
                setState(msg.payload.power);
            }

            // brightness
            if (msg.payload.brightness !== undefined) {
                setBrightness(msg.payload.brightness, msg.payload.speed);
            }

        });

        internalState.on('change', function () {
            refreshStateIndicator(internalState);
            sendStateMsg();
        });

        queryLampState();
    }


    RED.nodes.registerType('MagicHome', MagicHomeControlNode);

    function MagicHomeControlConfigNode(n) {
        RED.nodes.createNode(this, n);
        this.name = n.name;
        this.host = n.host;
    }
    RED.nodes.registerType('MagicHome-config', MagicHomeControlConfigNode);
};
