let LobbyBase = require('./LobbyBase')
let GameLobbySettings = require('./GameLobbySettings')
let Connection = require('../Connection')
let Bullet = require('../Bullet')
let LobbyState = require('../Utility/LobbyState')
let Vector2 = require('../Vector2')
let ServerItem = require('../Utility/ServerItem')
let AIBase = require('../AI/AIBase')
let TankAI = require('../AI/TankAI')
const axios = require('axios');
const Player = require('../Player')

module.exports = class GameLobbby extends LobbyBase {
    constructor(settings = GameLobbySettings) {
        super();
        this.settings = settings;
        this.lobbyState = new LobbyState();
        this.bullets = [];
        this.endGameLobby = function() {};
        this.peopleInLobby = settings.maxPlayers;
        this.lobbyStarted = false;
    }

    onUpdate() {
        super.onUpdate();

        let lobby = this;
        let serverItems = lobby.serverItems; 
        
        let aiList = serverItems.filter(item => {return item instanceof AIBase;});
        aiList.forEach(ai => {
            //Update each ai unity, passing in a function for those that need to update other connections
            ai.onObtainTarget(lobby.connections);

            ai.onUpdate(data => {
                lobby.connections.forEach(connection => {
                    let socket = connection.socket;
                    socket.emit('updateAI', data);
                });
            }, (data) => {
                lobby.onFireBullet(undefined, data, true);
            });
        });

        lobby.updateBullets();
        lobby.updateDeadPlayers();

        if(lobby.peopleInLobby == 1)
        {
            lobby.connections.forEach(c => {
                let player = c.player;
                if(!player.finish){
                    console.log('winer :  '+ player.username);
                    lobby.win(player,c);
                }
                    
                lobby.peopleInLobby = lobby.peopleInLobby - 1;
            });
        }

        
        //Clos lobby because no one is here
        if (lobby.connections.length == 0) {
            lobby.endGameLobby();
        }
    }

    canEnterLobby(connection = Connection) {
        let lobby = this;
        let maxPlayerCount = lobby.settings.maxPlayers;
        let currentPlayerCount = lobby.connections.length;

        if(currentPlayerCount + 1 > maxPlayerCount) {
            return false;
        }
        if(lobby.lobbyStarted)
        {
            return false;
        }

        return true;
    }

    onEnterLobby(connection = Connection) {
        let lobby = this;
        let socket = connection.socket;

        super.onEnterLobby(connection);

        //lobby.addPlayer(connection);

        if (lobby.connections.length == lobby.settings.maxPlayers) {
            console.log('We have enough players we can start the game');
            lobby.lobbyStarted = true;
            lobby.lobbyState.currentState = lobby.lobbyState.GAME;
            lobby.onSpawnAllPlayersIntoGame();
            //lobby.onSpawnAIIntoGame();
        }

        let returnData = {
            state: lobby.lobbyState.currentState
        };

        socket.emit('loadGame');
        socket.emit('lobbyUpdate', returnData);
        socket.broadcast.to(lobby.id).emit('lobbyUpdate', returnData);

        //Handle spawning any server spawned objects here
        //Example: loot, perhaps flying bullets etc
    }

    onLeaveLobby(connection = Connection) {
        let lobby = this;

        super.onLeaveLobby(connection);

        lobby.removePlayer(connection);

        //Handle unspawning any server spawned objects here
        //Example: loot, perhaps flying bullets etc
        lobby.onUnspawnAllAIInGame(connection);

        //Determine if we have enough players to continue the game or not
        if (lobby.connections.length < lobby.settings.minPlayers) {
            lobby.connections.forEach(connection => {
                if (connection != undefined) {
                    connection.socket.emit('unloadGame');
                    connection.server.onSwitchLobby(connection, connection.server.generalServerID);
                }
            });
        }
    }

    onSpawnAllPlayersIntoGame() {
        let lobby = this;
        let connections = lobby.connections;

        connections.forEach(connection => {
            lobby.addPlayer(connection);
        });
    }

    onSpawnAIIntoGame() {
        let lobby = this;
        lobby.onServerSpawn(new TankAI(), new Vector2(-6, 2));
    }

    onUnspawnAllAIInGame(connection = Connection) {
        let lobby = this;
        let serverItems = lobby.serverItems;

        //Remove all server items from the client, but still leave them in the server others
        serverItems.forEach(serverItem => {
            connection.socket.emit('serverUnspawn', {
                id: serverItem.id
            });
        });
    }
    lose(player = Player){
        const data = {
            id: player.telid,
            result:'lose'
        };

        const createUser = async () => {
            try {
                const res = await axios.post('https://localhost:44362/home/SetGameResult/', data);
                
            } catch (err) {
                console.error(err);
            }
        };

        createUser();
    }
    win(player = Player, connection = Connection){
        let socket = connection.socket;

        socket.emit('win',{
            id: player.id
        });

        const data = {
            id: player.telid,
            result:'win'
        };

        const createUser = async () => {
            try {
                const res = await axios.post('https://localhost:44362/home/SetGameResult/', data);
                
            } catch (err) {
                console.error(err);
            }
        };

        createUser();
    }
    updateBullets() {
        let lobby = this;
        let bullets = lobby.bullets;
        let connections = lobby.connections;

        bullets.forEach(bullet => {
            let isDestroyed = bullet.onUpdate();

            if(isDestroyed) {
                console.log(isDestroyed);
                lobby.despawnBullet(bullet);
            } else {
                /*var returnData = {
                    id: bullet.id,
                    position: {
                        x: bullet.position.x,
                        y: bullet.position.y
                    }
                }

                connections.forEach(connection => {
                    connection.socket.emit('updatePosition', returnData);
                });*/
            }
        });
    }

    updateDeadPlayers() {
        let lobby = this;
        let connections = lobby.connections;

        connections.forEach(connection => {
            let player = connection.player;

            if(player.isDead && player.life != 0) {
                let isRespawn = player.respawnCounter();
                if(isRespawn) {
                    let socket = connection.socket;
                    let returnData = {
                        id: player.id,
                        name: player.username,
                        position: lobby.getRandomSpawn()
                    }
                    
                    socket.emit('playerRespawn', returnData);
                    socket.broadcast.to(lobby.id).emit('playerRespawn', returnData);
                }
            }
        });

        let aiList = lobby.serverItems.filter(item => {return item instanceof AIBase;});
        aiList.forEach(ai => {
            if(ai.isDead) {
                let isRespawn = ai.respawnCounter();
                if(isRespawn) {
                    let socket = connections[0].socket;
                    let returnData = {
                        id: ai.id,
                        position: {
                            x: ai.position.x,
                            y: ai.position.y
                        }
                    }

                    socket.emit('playerRespawn', returnData);
                    socket.broadcast.to(lobby.id).emit('playerRespawn', returnData);
                }
            }
        });
    }

    onFireBullet(connection = Connection, data, isAI = false) {
        let lobby = this;

        let bullet = new Bullet();
        bullet.name = 'Bullet';
        bullet.activator = data.activator;
        bullet.position.x = data.position.x;
        bullet.position.y = data.position.y;
        bullet.direction.x = data.direction.x;
        bullet.direction.y = data.direction.y;

        lobby.bullets.push(bullet);

        var returnData = {
            name: bullet.name,
            id: bullet.id,
            activator: bullet.activator,
            position: {
                x: bullet.position.x,
                y: bullet.position.y
            },
            direction: {
                x: bullet.direction.x,
                y: bullet.direction.y
            },
            speed: bullet.speed
        }

        if (!isAI) {
            connection.socket.emit('serverSpawn', returnData);
            connection.socket.broadcast.to(lobby.id).emit('serverSpawn', returnData); //Only broadcast to those in the same lobby as us
        } else if (lobby.connections.length > 0) {
            lobby.connections[0].socket.emit('serverSpawn', returnData);
            lobby.connections[0].socket.broadcast.to(lobby.id).emit('serverSpawn', returnData); //Broadcast to everyone that the ai spawned a bullet for
        }        
    }

    onCollisionDestroy(connection = Connection, data) {
        let lobby = this;
        
        let returnBullets = lobby.bullets.filter(bullet => {
            return bullet.id == data.id
        });
        
        returnBullets.forEach(bullet => {
            let playerHit = false;

            var count = 0;

            lobby.connections.forEach(c => {
                let player = c.player;

                if(bullet.activator != player.id) {
                    let distance = bullet.position.Distance(player.position);
                    //distance < 1 ||
                    if(player.id == data.victom) {
                        let damage = 50
                        let isDead = player.dealDamage(damage);

                        connection.socket.emit('playerHealth',{id: player.id , damage: damage});
                        console.log('we hit player is Dead: '+isDead);


                        if(isDead) {
                            player.life = player.life - 1;
                            console.log('Player with id: ' + player.id + ' has died');
                            let returnData = {
                                id: player.id,
                                life: player.life
                            }
                            c.socket.emit('playerDied', returnData);
                            c.socket.broadcast.to(lobby.id).emit('playerDied', returnData);
                            if(player.life==0)
                            {
                                lobby.peopleInLobby = lobby.peopleInLobby - 1;
                                console.log("sdhiuh");
                                player.finish = true;

                                lobby.lose(player);
                                
                            }
                        } else {
                            console.log('Player with id: ' + player.id + ' has (' + player.health + ') health left');
                        }
                        playerHit = true;
                        console.log("playerHit");
                        lobby.despawnBullet(bullet);
                    }
                }
                
                if(!player.finish){
                    count = count + 1;
                }
                
            });
            // if(count == 1){
            //     console.log("win");
            // }
            
            if (!playerHit) {
                let aiList = lobby.serverItems.filter(item => {return item instanceof AIBase;});
                aiList.forEach(ai => {
                    if (bullet.activator != ai.id) {
                        let distance = bullet.position.Distance(ai.position);

                        if (distance < 0.8) {
                            let isDead = ai.dealDamage(50);
                            if (isDead) {
                                console.log('Ai has died');
                                let returnData = {
                                    id: ai.id
                                }
                                lobby.connections[0].socket.emit('playerDied', returnData);
                                lobby.connections[0].socket.broadcast.to(lobby.id).emit('playerDied', returnData);
                            } else {
                                console.log('AI with id: ' + ai.id + ' has (' + ai.health + ') health left');
                            }
                        }
                        playerHit = true;
                        console.log("playerHit");
                        lobby.despawnBullet(bullet);
                    }
                });
            }

            if(!playerHit) {
                bullet.isDestroyed = true;
            }
        });        
    }

    despawnBullet(bullet = Bullet) {
        let lobby = this;
        let bullets = lobby.bullets;
        let connections = lobby.connections;

        console.log('Destroying bullet (' + bullet.id + ')');
        var index = bullets.indexOf(bullet);
        if(index > -1) {
            bullets.splice(index, 1);

            var returnData = {
                id: bullet.id
            }

            //Send remove bullet command to players
            connections.forEach(connection => {
                connection.socket.emit('serverUnspawn', returnData);
            });
        }
    }

    addPlayer(connection = Connection) {
        let lobby = this;
        let connections = lobby.connections;
        let socket = connection.socket;

        let randomPosition = lobby.getRandomSpawn();
        connection.player.position = new Vector2(randomPosition.x, randomPosition.y);

        var returnData = {
            id: connection.player.id,
            name: connection.player.username,
            position: connection.player.position
        }

        socket.emit('spawn', returnData); //tell myself I have spawned
        socket.broadcast.to(lobby.id).emit('spawn', returnData); // Tell others

        //Tell myself about everyone else already in the lobby
        connections.forEach(c => {
            if(c.player.id != connection.player.id) {
                socket.emit('spawn', {
                    id: c.player.id,
                    position: c.player.position
                });
            }
        });
    }

    removePlayer(connection = Connection) {
        let lobby = this;
        
        connection.socket.broadcast.to(lobby.id).emit('disconnected', {
            id: connection.player.id
        });
    }

    getRandomSpawn() {
        let lobby = this;
        let index = lobby.getRndInteger(0, lobby.settings.levelData.freeForAllSpawn.length);

        return {
            x: lobby.settings.levelData.freeForAllSpawn[index].position.x,
            y: lobby.settings.levelData.freeForAllSpawn[index].position.y
        }
    }

    //Includes Min, Exlcudes Max
    getRndInteger(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
    }
}