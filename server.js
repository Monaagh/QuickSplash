const path = require('path');
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const dbUtil = require('./dbUtils');
const port = process.env.PORT || 5000;
// app.use(express.static(path.join(__dirname, '../../public')));
app.use(express.static("./build"));
var rooms = [];
var codes = [];
// var usernames = [];
var currentRoom = -1;

let mongoose = require('mongoose');

// set up default conn with the password
let db = 'mongodb+srv://A:ABCd1234!@quicksplash-db-dmuwu.mongodb.net/test?retryWrites=true';
mongoose.connect(db, {useNewUrlParser: true});
let qpDB = mongoose.connection;

// getting a PlayerInfo Schema and Model
let PlayerInfo = require('./PlayerInfoModel');


io.on('connection', function (socket) {

    // console.log("user connected");

    socket.on("login", function (loginInfo) {

        logObj = JSON.parse(loginInfo);
        let username = logObj.username;
        let password = logObj.password;

        // console.log(logObj);

        // query db for PlayerInfo
        let auth = false;

        // find all athletes who play tennis, selecting the 'name' and 'age' fields
        PlayerInfo.findOne({'username': username}, 'password', function (err, account) {
            if (err) {
                // emit Login Failed
                return handleError(err);
            }

            // console.log(account);

            if (account !== null && password === account.password)
                socket.emit('login-success');
            else
                socket.emit('login-fail');

        });

    });

    socket.on("signUp", function (signUpInfo) {
        // console.log(signUpInfo);

        logObj = JSON.parse(signUpInfo);
        let fname = logObj.fname;
        let lname = logObj.lname;
        let email = logObj.email;
        let username = logObj.username;
        let password = logObj.password;

        // do input sanitization

        PlayerInfo.findOne({'username': username}, username, function (err, account) {
            if (err) {
                return handleError(err);
            }

            console.log(account);

            // New PlayerInfo -
            if (account === null) {
                // create and add new account to db
                let newAccount = new PlayerInfo({
                    fname: fname,
                    lname: lname,
                    email: email,
                    username: username,
                    password: password,
                    tWins: 0,
                    tPoints: 0,
                    tGamePlayed: 0
                });

                newAccount.save(function (err) {
                    if (err) return "You Fucked up!";
                });

                socket.emit('signUp-success');
            } else {
                socket.emit('signUp-fail');
            }
        });


    });

    socket.on('profile', function(uname) {

        // console.log('profile info req by ' + uname);
        getInfo(uname).then(function(info)
        {
            console.log('_________________________________________________________');
            console.log("the profile info: ", info);
            console.log('_________________________________________________________');
            socket.emit('profileInfo', info);
        });
    });

    //actions to be taken when a user creates a lobby
    socket.on('createLobby', function (ruleSet) {

        //generate a join code and make sure it's unique
        while (true) {
            var duplicate = false;
            var generatedCode = (Math.floor((Math.random() * 1000))).toString(10);
            for (var i = 0; i < codes.length; i++) {
                if (codes[i].localeCompare(generatedCode) === 0) {
                    duplicate = true;
                }
            }
            if (!duplicate) {
                codes.push(generatedCode);
                break;
            }
        }

        //set the variables for the created lobby
        currentRoom++;
        var room = {
            name: "room" + currentRoom,
            code: generatedCode,
            rules: ruleSet,
            currentRound: 0,
            players: [],
            questions: [],
            allQuestions: [],
            hasStarted: false,
            initNumPlayers: 0,
            playersVoted: [],
            playersAnswered: [],
            usernames: []
        };

        //add the lobby to the list of lobbies
        rooms.push(room);

        //add the user to the lobby they just created
        //socket.join(room.name);
        socket.emit('joinAsCreator', generatedCode);

        //debugging/logging statements
        console.log("***************");
        console.log("Created a lobby");
        console.log("Join code: " + room.code);
        console.log(room.rules)

    });

    //actions to be taken when a user joins a lobby
    socket.on('joinLobby', function (joinCode, nickname, username) {

        let errorMessage = "Please check your join code and try again";
        //compare the join code entered by the user to the join codes of all
        //the lobbies on the server
        //if a match is found, add user to correct lobby
        let correctCode = false;
        let uniqueName = true;
        let hasSpace = false;
        let room = {};
        for (let i = 0; i < rooms.length; i++) {
            if (joinCode === rooms[i].code) {
                correctCode = true;
                room = rooms[i];
                let lobbySize = room.rules.lobbySize;
                if (room.players.length < lobbySize) {
                    hasSpace = true;
                } else {
                    errorMessage = "The lobby you tried to join is already full";
                }
            }
        }
        if (correctCode) {
            for (let j = 0; j < room.players.length; j++) {
                if (room.players[j].nickname === nickname) {
                    errorMessage = "Your nickname is not unique. Please change it and try again";
                    uniqueName = false;
                }
            }
        }
        let hasStarted = room.hasStarted;
        if (hasStarted){
            errorMessage = "Sorry, the lobby you tried to join has already started playing";
        }
        if (uniqueName && correctCode && hasSpace && !hasStarted) {
            let temp1 = {
                username: username,
                nickname: nickname,
                playerSocketId: socket.id,
            };
            room.usernames.push(temp1);
            let temp2 = {
                nickname: nickname,
                score: 0,
                colour: getColour(),
                playerSocketId: socket.id,
                AFKCount: 0
            };
            room.players.push(temp2);
            socket.join(room.name);
            console.log('new colour = ' + temp2.colour);
            socket.emit('waiting', temp2.colour);
            io.to(room.name).emit('addPlayers', room.players);
            //debugging/logging statements
            console.log("***************");
            console.log(nickname + " joined " + room.name);
        }
        //send error message if the user fails to join
        else {
            socket.emit('failedToJoin', errorMessage);
        }

    });

    //actions to be taken when a game starts.
    socket.on('startGame', function (code) {

        var room = findLobby(code);
        if (room.players.length >= 3) {
            loadQuestions(room);
            // set the game started bool to true
            room.hasStarted = true;
        } else {
            let errorMessage = "You need at least 3 players to start the game";
            socket.emit('failedToStart', errorMessage);
        }


    });

    socket.on('done voting', function (nick, colour, code) {

        let temp1 = {
            nickname: nick,
            colour: colour
        };

        let room = findLobby(code);

        room.playersVoted.push(temp1);

        console.log('------------------------------------')
        console.log(room.usernames);
        console.log('------------------------------------')

        // socket.emit('vote done', room.playersVoted);


        for (let i = 0; i < room.playersVoted.length; i++) {

            for (let j = 0; j < room.usernames.length; j++) {
                if ((room.playersVoted[i].nickname === room.usernames[j].nickname)) {
                    console.log(room.playersVoted);
                    io.to(room.usernames[j].playerSocketId).emit('vote done', room.playersVoted);
                }
            }
        }
    });

    function loadQuestions(room) {
        // get random question here
        let questionList = ["DD"];

        //retrieve all the required questions
        //For N players, N questions are needed per round
        //So total number of questions needed = N * number of rounds
        dbUtil.getRandomQuestion(room.players.length * room.rules.numRounds).then((retQuestion) => {
            questionList = retQuestion;
            console.log("-----------------------LOADED-------------------!");
            // emit socket event to set the question
            console.log(questionList);
            room.allQuestions = questionList;
            init(room, questionList);
        });
    }

    function init(room, questionList) {
        room.initNumPlayers = room.players.length;
        room.currentRound++;
        io.to(room.name).emit('roundTransition');
        setTimeout(function () {
            sendQuestions(room, questionList);
        }, 3000);
    }

    function sendQuestions(room, questionList) {
        try {
            room.questions = [];
            let players = io.sockets.adapter.rooms[room.name].sockets;
            let index = 0;
            let timePerRound = room.rules.timePerRound;
            for (let player in players) {
                let playerSocket = io.sockets.connected[player];
                let question1 = questionList[index++];
                var question = {
                    text: question1,
                    answers: []
                };
                room.questions.push(question);
                var numPlayers = Object.keys(players).length;
                if (index === numPlayers) {
                    index = 0;
                }
                let question2 = questionList[index];
                console.log(room.questions);

                playerSocket.emit('prompt1', question1, question2, timePerRound);

            }

            var timeUntilVote = ((parseInt(timePerRound, 10) + 1) * 1000);

            setTimeout(function () {
                checkNoResponse(room);
            }, timeUntilVote);

            setTimeout(function () {
                voting(room);
            }, timeUntilVote + 2000);
        }
        catch(err){
            console.log("ERROR")
        }
    }

    // send a prompt2 when a response received
    socket.on('response', function (nickname, answer, question, code, isEmpty) {
        try {
            var room = findLobby(code);
            //find the question in the lobby's list of questions
            //assign answer to said question

            console.log('response from: ', +nickname);

            for (var i = 0; i < room.questions.length; i++) {
                if (room.questions[i].text === question) {
                    var temp = {
                        nickname: nickname,
                        text: answer,
                        votes: 0
                    };
                    room.questions[i].answers.push(temp);
                }
            }
            if (!isEmpty) {
                socket.emit('prompt2');
                for (let i = 0; i < room.players.length; i++) {
                    if (room.players[i].nickname === nickname) {
                        room.players[i].AFKCount = 0;
                    }
                }
            } else {
                for (let i = 0; i < room.players.length; i++) {
                    if (room.players[i].nickname === nickname) {
                        room.players[i].AFKCount++;
                        let maxAFK = room.rules.afkTimeout;
                        if (room.players[i].AFKCount >= maxAFK) {
                            console.log("Max AFK", maxAFK);
                            console.log("AFK Count", room.players[i].AFKCount);
                            handleDisconnect();
                        }
                    }
                }
            }
        }
        catch(err){
            console.log("ERROR")
        }
    });

    // send a waiting screen
    socket.on('response2', function (nickname, answer, question, code, isEmpty) {
        try {
            let room = findLobby(code);

            console.log('response from: ', +nickname);

            let playerColour = 'redSplashPlayer';

            for (let i = 0; i< room.players.length; i++){
                if (room.players[i].nickname === nickname)
                    playerColour = room.players[i].colour;
            }


            let temp1 = {
                nickname: nickname,
                colour: playerColour
            };

            room.playersAnswered.push(temp1);

            for (let i = 0; i < room.playersAnswered.length; i++) {

                for (let j = 0; j < room.usernames.length; j++) {
                    if ((room.playersAnswered[i].nickname === room.usernames[j].nickname)) {
                        io.to(room.usernames[j].playerSocketId).emit('waiting2', room.playersAnswered);
                    }
                }
            }


            //find the question in the lobby's list of questions
            //assign answer to said question
            for (let i = 0; i < room.questions.length; i++) {
                if (room.questions[i].text === question) {
                    let temp = {
                        nickname: nickname,
                        text: answer,
                        votes: 0
                    };
                    room.questions[i].answers.push(temp);
                }
            }
            // socket.emit('waiting2', room.playersAnswered);
            if (!isEmpty) {
                for (let i = 0; i < room.players.length; i++) {
                    if (room.players[i].nickname === nickname) {
                        room.players[i].AFKCount = 0;
                    }
                }
            } else {
                for (let i = 0; i < room.players.length; i++) {
                    if (room.players[i].nickname === nickname) {
                        room.players[i].AFKCount++;
                        let maxAFK = room.rules.afkTimeout;
                        if (room.players[i].AFKCount >= maxAFK) {
                            console.log("Max AFK", maxAFK);
                            console.log("AFK Count", room.players[i].AFKCount);
                            handleDisconnect();
                        }
                    }
                }
            }
        }
        catch(err){
            console.log("ERROR")
        }
    });

    function checkNoResponse(room) {
        io.to(room.name).emit('checkNoResponse');
    }

    function voting(room) {
        try {
            let offset = 0;
            let offset2 = 10000;
            let answer1;
            let answer2;
            let player1;
            let player2;
            for (let i = 0; i < room.questions.length; i++) {
                let prompt = room.questions[i].text;
                if (room.questions[i].answers[0] === undefined) {
                    let temp = {
                        nickname: "",
                        text: "-",
                        votes: 0
                    };
                    answer1 = temp.text;
                    room.questions[i].answers[0] = temp;
                } else {
                    answer1 = room.questions[i].answers[0].text;
                }
                if (room.questions[i].answers[1] === undefined) {
                    let temp = {
                        nickname: "",
                        text: "-",
                        votes: 0
                    };
                    answer2 = temp.text;
                    room.questions[i].answers[1] = temp;
                } else {
                    answer2 = room.questions[i].answers[1].text;
                }
                player1 = room.questions[i].answers[0].nickname;
                player2 = room.questions[i].answers[1].nickname;
                let isLast = false;
                if (i === room.questions.length - 1) {
                    isLast = true;
                }

                sendVote(room, prompt, answer1, answer2, player1, player2, offset, isLast);
                sendVoteResult(room, prompt, offset2);
                offset += 16000;
                offset2 += 16000;
            }
        }
        catch(err){
            console.log("ERROR")
        }
    }

    function sendVote(room, prompt, answer1, answer2, player1, player2, offset, isLast){
        try{
            let timeToVote = room.questions.length * 10;
            setTimeout(function(){
                console.log(prompt);
                io.to(room.name).emit('vote', prompt, timeToVote, answer1, answer2, player1, player2);
                io.to(room.name).emit('reset');
                room.playersVoted = [];
            }, offset);
            if (isLast) {
                setTimeout(function () {
                    results(room);
                }, (offset+16000));
            }
        } catch (err){
            console.log("ERROR");
        }
    }

    function sendVoteResult(room, question, offset){
        setTimeout( function(){
            try{
                for (let i=0; i<room.questions.length; i++){
                    if (room.questions[i].text === question){
                        let q = room.questions[i].text;
                        let a1 = room.questions[i].answers[0].text;
                        let a2 = room.questions[i].answers[1].text;
                        let v1 = room.questions[i].answers[0].votes;
                        let v2 = room.questions[i].answers[1].votes;
                        io.to(room.name).emit('voteResults', q, a1, a2, v1, v2);
                        break;
                    }
                }

            }catch (err) {
                console.log("ERROR");
            }
        }, offset);
    }

    socket.on('vote', function (code, question, answer) {
        var room = findLobby(code);
        for (var i = 0; i < room.questions.length; i++) {
            if (room.questions[i].text === question) {
                let answers = room.questions[i].answers;
                for (var j = 0; j < answers.length; j++) {
                    if (answers[j].text === answer) {
                        answers[j].votes++;
                        let player = answers[j].nickname;
                        for (var k = 0; k < room.players.length; k++) {
                            if (room.players[k].nickname === player) {
                                room.players[k].score += 100;
                            }
                        }
                    }
                }
            }
        }
    });

    function results(room) {
        try {
            for (var i = 0; i < room.questions.length; i++) {
                console.log(room.questions[i].answers);
            }
            for (var i = 0; i < room.players.length; i++) {
                console.log(room.players[i]);
            }
            room.players.sort(function (a, b) {
                return b.score - a.score;
            });
            io.to(room.name).emit('result', room.players);
            let numRounds = parseInt(room.rules.numRounds, 10);
            let currentRound = room.currentRound;
            console.log(currentRound);
            console.log(numRounds);
            if (currentRound < numRounds) {
                setTimeout(function () {
                    nextRound(room);
                }, 15000);
            } else {
                setTimeout(function () {
                    endGame(room);
                }, 23000);
            }
        }
        catch(err){
            console.log("ERROR")
        }
    }

    function nextRound(room) {
        try {
            room.allQuestions.splice(0, room.initNumPlayers);
            room.playersAnswered = [];
            init(room, room.allQuestions);
        }
        catch(err){
            console.log("ERROR")
        }
    }

    function endGame(room) {
        try {
            for (let i = 0; i < room.usernames.length; i++) {
                dbUtil.updateGamePlayed(room.usernames[i].username);
            }
            for (let i = 0; i < room.players.length; i++) {
                let username = getUsername(room.players[i].nickname, room);
                let score = room.players[i].score;
                dbUtil.updatePoints(username, score);
                if (i === 0) {
                    dbUtil.updateWins(username);
                }
            }
            io.to(room.name).emit('endGame');
            let index = rooms.indexOf(room);
            rooms.splice(index, 1);
            console.log(rooms);
        }
        catch(err){
            console.log("ERROR")
        }
    }

    function findLobby(code) {
        //uses the code passed from the player to determine the correct lobby
        var room = {};
        for (var i = 0; i < rooms.length; i++) {
            if (rooms[i].code.localeCompare(code) === 0) {
                room = rooms[i];
                rooms[i].hasStarted = true;
            }
        }
        return room;
    }

    // finds the players lobby and returns the index of the room if the player hasn't jioned a r
    // if the player hasn't joined returns -1
    function findPlayerLobby(socketId) {
        let roomId = -1;
        console.log(rooms.length);
        for (let i = 0; i < rooms.length; i++) {
            for (let j = 0; j < rooms[i].players.length; j++) {
                console.log('Players socketID' + rooms[i].players[j].playerSocketId + "The socket ID" + socketId);
                if (rooms[i].players[j].playerSocketId === socketId) {
                    roomId = i;
                }
            }
        }
        return roomId;
    }

    function getUsername(nickname, room) {
        let username = "";
        for (let i = 0; i < room.usernames.length; i++) {
            if (room.usernames[i].nickname === nickname) {
                username = room.usernames[i].username;
            }
        }
        return username;
    }

    function getColour() {
        let rn = Math.floor(Math.random() * Math.floor(8));  // will generate a random num from 0 to 7
        let colour = '';

        switch (rn) {

            case 0:
                colour = 'blueSplashPlayer';
                break;
            case 1:
                colour = 'tealSplashPlayer';
                break;
            case 2:
                colour = 'yellowSplashPlayer';
                break;
            case 3:
                colour = 'orangeSplashPlayer';
                break;
            case 4:
                colour = 'redSplashPlayer';
                break;
            case 5:
                colour = 'greenSplashPlayer';
                break;
            case 6:
                colour = 'purpleSplashPlayer';
                break;
            case 7:
                colour = 'pinkSplashPlayer';
                break;
            default:
                colour = 'redSplashPlayer';

        }
        return colour;
    }

    async function getInfo (uname) {
        let fname,lname,email,wins,gameplayed,points;
        fname = await dbUtil.getFname(uname);
        lname = await dbUtil.getLname(uname);
        email = await dbUtil.getEmail(uname);

        wins = await dbUtil.getWins(uname);
        gameplayed = await dbUtil.getGamePlayed(uname);
        points = await dbUtil.getPoints(uname);

        let info = {
            uname: uname,
            fname: fname,
            lname: lname,
            email: email,
            wins: wins,
            gameplayed: gameplayed,
            points: points
        }
        return info;
    }

    //actions to be taken when a user disconnects
    socket.on('disconnect', function () {

        handleDisconnect();

    });

    function handleDisconnect(){
        console.log("user disconnected with the following socket id: " + socket.id);
        // find out which player discounted
        let roomIndex = findPlayerLobby(socket.id);
        if (roomIndex != -1) {
            let roomName = rooms[roomIndex].name;
            // remove this player form this room
            for (let i = 0; i < rooms[roomIndex].players.length; i++) {
                if (rooms[roomIndex].players[i].playerSocketId === socket.id) {
                    rooms[roomIndex].players.splice(i, 1);
                }
            }
            // remove this player from username
            for (let i = 0; i < rooms[roomIndex].usernames.length; i++) {
                if (rooms[roomIndex].usernames[i].playerSocketId === socket.id) {
                    rooms[roomIndex].usernames.splice(i, 1);
                }
            }

            // check the number of players in this room
            if (rooms[roomIndex].players.length < 3 && rooms[roomIndex].hasStarted) {
                // kill this room
                io.to(rooms[roomIndex].name).emit('endGame');
                rooms.splice(roomIndex, 1);
                let players = io.sockets.adapter.rooms[roomName].sockets;
                for (let player in players) {
                    let playerSocket = io.sockets.connected[player];
                    playerSocket.leave(roomName);
                }
            } else {
                // kick only the person that left
                socket.emit('endGame');
                socket.leave(roomName);
            }

        }
    }


});

//Bind connection to error event (to get notification of connection errors)
qpDB.on('error', console.error.bind(console, 'MongoDB connection error:'));


http.listen(port, function () {
    console.log('listening on *:' + port);
});
