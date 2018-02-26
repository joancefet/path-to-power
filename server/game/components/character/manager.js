import Promise from 'bluebird';

// Manager specific imports
import {
    ADD_ONLINE_PLAYER,
    REMOVE_ONLINE_PLAYER,
    EQUIP_ITEM,
    UNEQUIP_ITEM,
    UPDATE_CHARACTER,
    MOVE_CHARACTER,
    LEFT_GRID,
} from './types';
import {UPDATE_GROUND_ITEMS} from '../item/types';
import Character from './object';
import CharacterModel from './model';
import characterCommands from './commands';
import {joinedGrid} from './actions';
import Levels from '../../data/levels.json';
import {findObjectInArray} from '../../helper';

/**
 * Character Manager
 */
export default class CharacterManager {
    /**
     * Class constructor
     * @param  {Game} Game The game obejct
     */
    constructor(Game) {
        this.Game = Game;
        // keeps track of all current in-game characters
        this.characters = [];
        // log manager progress
        this.Game.logger.debug('CharacterManager::constructor Loaded');
        // listen for dispatches from the socket manager
        this.Game.socketManager.on('dispatch', this.onDispatch.bind(this));
        this.Game.socketManager.on('disconnect', (user) => {
            this.remove(user.user_id);
        });
    }

    /**
     * Register all the character commands
     */
    init() {
        this.Game.commandManager.registerManager(characterCommands);
        console.log('CHARACTERS MANAGER LOADED');
    }

    /**
     * checks for dispatches, and reacts only if the type is listend to
     * @param  {Socket.IO Socket} socket Client who dispatched the action
     * @param  {Object} action The redux action
     */
    onDispatch(socket, action) {
        switch (action.type) {
            case UNEQUIP_ITEM:
                return this.onUnEquip(socket, action);
            case EQUIP_ITEM:
                return this.onEquip(socket, action);
            case MOVE_CHARACTER:
                return this.move(socket, action);
        }

        return null;
    }

    /**
     * Handles item unequip requests from the client.
     * @param  {Socket.io Socket} socket The socket the action was dispatched from
     * @param  {Object}           action Redux action object
     */
    onUnEquip(socket, action) {
        try {
            const character = this.get(socket.user.user_id);
            character.unEquip(action.payload);
        } catch (err) {
            this.Game.onError(err, socket);
        }
    }

    /**
     * Handles item equip requests from the client.
     * @param  {Socket.io Socket} socket The socket the action was dispatched from
     * @param  {Object}           action Redux action object
     */
    onEquip(socket, action) {
        try {
            const character = this.get(socket.user.user_id);
            character.equip(action.payload);
        } catch (err) {
            this.Game.onError(err, socket);
        }
    }

    /**
     * Updates the client character information, in part or in full
     * @param  {String} user_id  User Id of client to update
     * @param  {Mixed} property (optional) if only a part of the character needs updating
     */
    updateClient(user_id, property = null) {
        const character = this.get(user_id);

        if (!character) {
            return;
        }

        const characterData = character.exportToClient();

        this.Game.socketManager.dispatchToUser(user_id, {
            type: UPDATE_CHARACTER,
            payload: property ? {[property]: characterData[property]} : characterData,
        });
    }

    /**
     * Return a player object, matching the name
     * @param  {Strinmg} characterName name or part of name to search for
     * @return {Character Obj}
     */
    getByName(characterName) {
        // first check if there is a direct match between the name and a player
        return findObjectInArray(this.characters, 'name_lowercase', characterName.toLowerCase());
    }

    /**
     * gets the character of the user ID, if one exists
     * @param  {String} user_id User ID
     * @return {Promise}
     */
    get(user_id) {
        if (!user_id) {
            return null;
        }

        return this.characters.find((obj) => obj.user_id === user_id) || null;
    }

    /**
     * Dispatches an event to all sockets, adding a player to the playerlist
     * @param  {String} user_id The user ID
     * @param  {String} name    Name of the character
     */
    dispatchUpdatePlayerList(user_id) {
        const character = this.get(user_id);

        if (!character) {
            return;
        }

        // update the clients online player list
        this.Game.socketManager.dispatchToServer({
            type: ADD_ONLINE_PLAYER,
            payload: {
                user_id: character.user_id,
                name: character.name,
                profile_image: character.profile_image,
                faction: character.faction ? {
                    tag: character.faction.tag,
                    name: character.faction.name,
                    faction_id: character.faction.faction_id,
                } : null,
            },
        });
    }

    /**
     * Dispatches an event to all sockets, removing a player tfrom the playerlist
     * @param  {String} user_id The user ID
     */
    dispatchRemoveFromPlayerList(user_id) {
        // update the clients online player list
        this.Game.socketManager.dispatchToServer({
            type: REMOVE_ONLINE_PLAYER,
            payload: {
                user_id,
            },
        });
    }

    /**
     * Adds a character class object to the managed list
     * @param  {Character Obj} character The character object to manage
     */
    async manage(character) {
        // removes disconnect timer, if one is sec (eg if refreshing the page)
        const wasLoggedIn = this.Game.socketManager.clearTimer(character.user_id);
        const existingCharacter = this.characters.find((obj) => obj.user_id === character.user_id);

        if (wasLoggedIn && existingCharacter) {
            // re-add targetedBy, if the player has any
            // NOTE: reapply any temporary effects here to avoid relogging to clear them
            existingCharacter.targetedBy.forEach((user) => {
                character.gridLock(user);
            });

            await this.remove(character.user_id);
        }

        // load the character abilities
        this.Game.abilityManager.load(character);

        // load the character skills
        this.Game.skillManager.load(character);

        // check if they are in a faction, and load the faction if so
        const faction = this.Game.factionManager.get(character.faction_id);

        // if they are in a faction, add them to the online list in the faction, and
        // add the faction object to the character
        if (faction) {
            faction.linkCharacter(character);
        }

        // add the character object to the managed list of characters
        this.characters.push(character);
        this.dispatchUpdatePlayerList(character.user_id);

        const socket = this.Game.socketManager.get(character.user_id);

        // dispatch join event to grid
        this.Game.eventToRoom(character.getLocationId(), 'info', `${character.name} emerges from a nearby building`, [character.user_id]);
        // update the grid's player list
        this.Game.socketManager.dispatchToRoom(
            character.getLocationId(),
            this.Game.characterManager.joinedGrid(character)
        );

        try {
            // join the grid room
            socket.join(character.getLocationId());
        } catch (err) {
            this.Game.onError(err, socket);
        }
    }

    /**
     * Remove a managed character from the list
     * @param  {String} user_id User ID
     */
    async remove(user_id) {
        const character = this.get(user_id);

        if (!character) {
            return;
        }

        try {
            await this.save(character.user_id);
        } catch (err) {
            this.Game.onError(err);
        }

        // dispatch join event to grid
        this.Game.eventToRoom(character.getLocationId(), 'info', `${character.name} disappears into a nearby building`, [character.user_id]);

        // remove player from the grid list of players
        this.Game.socketManager.dispatchToRoom(character.getLocationId(), {
            type: LEFT_GRID,
            payload: character.user_id,
        });

        if (character.faction) {
            character.faction.unlinkCharacter(character);
        }

        this.characters = this.characters.filter((obj) => obj.user_id !== user_id);
        this.dispatchRemoveFromPlayerList(user_id);
    }

    /**
     * loads a character from the mongodb, based on user_id
     * @param  {Object}   userData  The twitch user data
     * @param  {Function} callback  Callback function
     * @return {Object}             Object with the character details.
     */
    async load(userData) {
        const character = await this.dbLoad(userData.user_id);

        if (character === null) {
            return null;
        }

        const newCharacter = new Character(this.Game, character.toObject());
        newCharacter.profile_image = userData.profile_image;

        await this.manage(newCharacter);

        const items = await this.Game.itemManager.loadCharacterInventory(newCharacter);

        if (items) {
            newCharacter.setInventory(items);
            items.map((item, index) => {
                if (item.equipped_slot) {
                    newCharacter.equip(index);
                }
            });
        }

        return newCharacter;
    }

    /**
     * Get the list of all online characterss
     * @return {Object} Object containing user_id => name objects
     */
    getOnline() {
        return this.characters.map((character) => ({
                name: character.name,
                user_id: character.user_id,
                profile_image: character.profile_image,
                faction: character.faction ? {
                    tag: character.faction.tag,
                    name: character.faction.name,
                    faction_id: character.faction.faction_id,
                } : null,
            })
        );
    }

    /**
     * database method, attempts to load a character from the database
     * @param  {String}   user_id  User ID who owns the character
     * @param  {Function} callback returns error and character object
     */
    dbLoad(user_id) {
        return CharacterModel.findOneAsync({user_id: user_id});
    }

    /**
     * create a new character
     * @param  {Object}   userData The twitch user data
     * @param  {String}   name     Character Name
     * @param  {String}   city     Starting city ID
     * @param  {Function} callback Callback function
     * @return {Object}            Object with the character details
     */
    async create(userData, city) {
        const character = await this.dbCreate(userData.user_id, userData.display_name, city);
        const newCharacter = new Character(this.Game, character.toObject());
        newCharacter.profile_image = userData.profile_image;

        await this.manage(newCharacter);
        return newCharacter;
    }

    /**
     * Database method, will attempts to create a new character
     * @param  {String}   user_id        User Id of account
     * @param  {String}   character_name Twitch Name
     * @param  {String}   city           ID of city to start in
     */
    async dbCreate(user_id, character_name, city) {
        const newCharacter = new CharacterModel({
            user_id: user_id,
            name: character_name,
            location: {
                map: city,
            },
            stats: {...this.Game.config.game.defaultStats},
        });

        await newCharacter.saveAsync();
        return newCharacter;
    }

    /**
     * Save the progress and items of all managed characters
     * @return {Promise}
     */
    async saveAll() {
        await Promise.all(this.characters.map(async (character) => {
            try {
                return await this.save(character.user_id);
            } catch (err) {
                this.Game.onError(err);
            }
        }));
    }

    /**
     * Saves a character's (by used id) progress and items
     * @param  {String} user_id The user ID
     * @return {Promise}
     */
    async save(user_id) {
        if (!user_id) {
            throw new Error('No user_id supplied to the save() method');
        }

        const character = this.get(user_id);

        if (!character) {
            throw new Error(`No user found online, matching the user_id ${user_id}`);
        }

        this.Game.logger.info(`Saving character ${user_id}`);

        // Save the character information (stats/location/etc)
        await this.dbSave(character);
        await this.Game.itemManager.saveInventory(character);

        this.Game.logger.info(`Saved ${character.name} (${user_id})`);
    }

    /**
     * Save the character stats, location etc to permanent storage
     * @param  {Character Obj} character The character to save
     * @return {Promise}
     */
    async dbSave(character) {
        const dbCharacter = await CharacterModel.findOneAsync({user_id: character.user_id});

        // update the character db object, and save the changes
        // NOTE: add any information you want to save here.
        dbCharacter.stats = {...character.stats};
        dbCharacter.abilities = character.exportAbilities();
        dbCharacter.skills = character.exportSkills();
        dbCharacter.location = {...character.location};
        dbCharacter.faction_id = character.faction ? character.faction.faction_id : '';

        await dbCharacter.saveAsync();
        return dbCharacter;
    }

    /**
     * Find a character in the database, by name
     * @param  {Strng} characterName  Name to search for
     * @return {Object}               Plain object of character.
     */
    async dbGetByName(targetName) {
        const character = await CharacterModel.findOneAsync({name_lowercase: targetName.toLowerCase()});
        return character ? character.toObject() : null;
    }

    /**
     * Get the list of players at a given location
     * @param  {String} map Map Id
     * @param  {Number} x
     * @param  {Number} y
     * @param  {String} ignore      Ignored a specific user_id, used for returning lists to the user.
     * @param  {Boolean} toClient   Whether to return the references or list of user_ids and names (to be sent to client)
     * @return {Array}     Array of players
     */
    getLocationList(map, x = null, y = null, ignore = null, toClient = false) {
        let players;

        // if we need to get NPCs from a specific grid within a map
        if (x !== null && y !== null) {
            players = this.characters.filter((obj) => obj.location.map == map && obj.location.y == y && obj.location.x == x);
        } else {
            players = this.characters.filter((obj) => obj.location.map === map);
        }

        if (!toClient) {
            return players;
        }

        return players
            .filter((obj) => obj.user_id !== ignore && !obj.hidden)
            .map((character) => {
                return this.joinedGrid(character, false);
            });
    }

    /**
     * Get the action object for a character, joining a grid
     * @param  {Character} character    The character to get the object of
     * @param  {Bool}      createAction Whether to return an action from the action creator or not.
     * @return {Object}                 Redux action object
     */
    joinedGrid(character, action = true) {
        // TODO: Refactor this to be a action dispatch instead.
        const details = {
            name: character.name,
            user_id: character.user_id,
        };

        if (!action) {
            return details;
        }

        return joinedGrid(details);
    }

    /**
     * Removes a character from a given map grid
     * @param  {Object} position     The position to remove the player from
     * @param  {Character} character The character to remove
     */
    removeFromGrid(position, character) {
        const playersInGrid = this.locations[`${position.map}_${position.y}_${position.x}`];

        // if the old location does not exist, we dont need to remove the player from it
        if (playersInGrid) {
            // find index of the play
            const index = playersInGrid.findIndex((char) => char.user_id === character.user_id);

            // and remove the player from the list, if found
            if (index !== -1) {
                playersInGrid.splice(index, 1);
            }
        }
    }

    /**
     * Get the rank name, based on the amount of EXP
     * @param  {Number} exp The exp amount
     * @return {String}     The rank name
     */
    getRank(exp) {
        const levelCount = Levels.length - 1;
        let rank;

        for (let i = 0; i < levelCount; i++) {
            if (Levels[i].exp > exp) {
                rank = Levels[i - 1].name;
                break;
            }
        }

        return rank;
    }

    /**
     * Adds a character to the specific map grid
     * @param {Object} position     The location to add the character to
     * @param {Character} character The character to add to the grid
     */
    addToGrid(position, character) {
        const location_key = `${position.map}_${position.y}_${position.x}`;

        // if the location array is not set yet, make it
        if (!this.locations[location_key]) {
            this.locations[location_key] = [];
        }

        // if they are already on the list, ignore.
        if (this.locations[location_key].findIndex((char) => char.user_id === character.user_id) !== -1) {
            return;
        }

        this.locations[location_key].push(character);
    }

    /**
     * Moves a character to the specific location, emitting related events on the way to and from
     * @param  {Socket.IO Socket} socket    The socket of the character moving
     * @param  {Object} moveAction {grid: 'y|x', direction: 1|-1}
     * @return {Promise}
     */
    move(socket, action) {
        const moveAction = action.payload;
        // get the socket character
        const character = this.get(socket.user.user_id);

        if (!character) {
            return this.Game.eventToSocket(socket, 'error', 'You do not appear to be logged in any more. Please login again.');
        }

        let actionNewLocation = {...character.location};
        let directionOut;
        let directionIn;

        // check if character is gridlocked/being targeted by other players
        if (character.targetedBy.length) {
            const list = character.targetedBy.map((obj) => {
                return obj.name;
            }).join(', ');

            return this.Game.eventToSocket(socket, 'warning', `You can't move as the following players are aiming at you: ${list}`);
        }

        // check if the player is hidden
        if (character.hidden) {
            return this.Game.eventToSocket(socket, 'warning', 'You can\'t move as long as you are hidden. type /unhide to come out of hiding.');
        }

        const cooldownAction = 'move';
        // check if the character has an existing cooldown from moving
        if (this.Game.cooldownManager.ticksLeft(character, cooldownAction)) {
            return;
        }

        // set the cooldown of the move action
        const newCooldown = this.Game.cooldownManager.add(character, cooldownAction);

        // set the location we intend to move the character to
        actionNewLocation[moveAction.grid] = actionNewLocation[moveAction.grid] + moveAction.direction;

        try {
            // make sure the move is valid
            const newLocation = this.Game.mapManager.isValidLocation(actionNewLocation.map, actionNewLocation.x, actionNewLocation.y);

            if (!newLocation) {
                return;
            }

            // determin the direction names for the JOIN/LEAVE events
            switch (moveAction.grid) {
                case 'y':
                    if (moveAction.direction === 1) {
                        directionOut = 'South';
                        directionIn = 'North';
                    } else {
                        directionOut = 'North';
                        directionIn = 'South';
                    }
                    break;
                case 'x':
                    if (moveAction.direction === 1) {
                        directionOut = 'East';
                        directionIn = 'West';
                    } else {
                        directionOut = 'West';
                        directionIn = 'East';
                    }
                    break;
            }

            // remove aim from current target, if set
            character.releaseTarget();

            // leave the old grid room
            socket.leave(character.getLocationId());

            // dispatch leave message to grid
            this.Game.eventToRoom(character.getLocationId(), 'info', `${character.name} leaves to the ${directionOut}`, [character.user_id]);
            // remove player from the grid list of players
            this.Game.socketManager.dispatchToRoom(character.getLocationId(), {
                type: LEFT_GRID,
                payload: character.user_id,
            });

            // update character location
            character.updateLocation(newLocation.map, newLocation.x, newLocation.y);

            // dispatch join message to new grid
            this.Game.eventToRoom(character.getLocationId(), 'info', `${character.name} strolls in from the ${directionIn}`, [character.user_id]);

            // add player from the grid list of players
            this.Game.socketManager.dispatchToRoom(
                character.getLocationId(),
                this.Game.characterManager.joinedGrid(character)
            );

            // update the socket room
            socket.join(character.getLocationId());

            // update client/socket character and location information
            this.updateClient(character.user_id);

            // send the new grid details to the client
            this.Game.mapManager.updateClient(character.user_id);

            // start the cooldown timer
            newCooldown.start();
        } catch (err) {
            this.Game.onError(err, socket);
        }
    }

    /**
     * Kills a character, drops their loot, and respawns them at the map respawn location
     * @param  {String} user_id   The user ID of the character to kill
     * @param {Character} killer  The character obj of the killer.
     * @return {Promise}
     */
    kill(user_id, killer) {
        // fetch the character who got killed
        const character = this.get(user_id);
        // get the map so we know where to respawn the player
        const gameMap = this.Game.mapManager.get(character.location.map);
        // kill the character
        const droppedLoot = character.die();
        // save the old location before it is overwritten by the die() method on the character
        const oldLocationId = character.getLocationId();
        // save the old location
        const oldLocation = {...character.location};
        // the respawn location
        const newLocation = {
            map: gameMap.id,
            ...gameMap.respawn,
        };

        // leave the old grid room
        this.Game.socketManager.userLeaveRoom(character.user_id, character.getLocationId());

        // remove player from the grid list of players
        this.Game.socketManager.dispatchToRoom(character.getLocationId(), {
            type: LEFT_GRID,
            payload: character.user_id,
        });

        // update character location
        character.updateLocation(newLocation.map, newLocation.x, newLocation.y);

        // drop all items on the ground
        droppedLoot.items.forEach((item) => {
            this.Game.itemManager.drop(oldLocation.map, oldLocation.x, oldLocation.y, item);
        });

        // TODO: Test if this works! Need more players to test.
        const cashReward = Math.floor(droppedLoot.cash / droppedLoot.targetedBy.length);
        const expReward = Math.floor(droppedLoot.exp / droppedLoot.targetedBy.length);
        droppedLoot.targetedBy.forEach((char) => {
            // give them an equal amount of cash and exp, from the dropped loot
            char.updateCash(cashReward);

            // make sure its a player
            if (char.user_id) {
                char.updateExp(expReward);
                this.updateClient(char.user_id);
            }
        });

        // Let the killer know how much money they received, if its not an NPC
        if (killer.user_id) {
            this.Game.eventToUser(killer.user_id, 'info', `You find ${droppedLoot.cash} money on ${character.name} body.`);
        }

        // update the client's ground look at the location
        this.Game.socketManager.dispatchToRoom(oldLocationId, {
            type: UPDATE_GROUND_ITEMS,
            payload: this.Game.itemManager.getLocationList(oldLocation.map, oldLocation.x, oldLocation.y, true),
        });

        // add player from the grid list of players
        this.Game.socketManager.dispatchToRoom(
            character.getLocationId(),
            this.Game.characterManager.joinedGrid(character)
        );

        // update the socket room
        this.Game.socketManager.userJoinRoom(character.user_id, character.getLocationId());

        // update client/socket character and location information
        this.updateClient(character.user_id);

        // send the new grid details to the client
        this.Game.mapManager.updateClient(character.user_id);

        return oldLocationId;
    }
}
