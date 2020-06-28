const functions = require('firebase-functions');
const Telegraf = require('telegraf')
const Extra = require('telegraf/extra')
const Markup = require('telegraf/markup')

// authenticate so we can access services
const admin = require('firebase-admin');
admin.initializeApp();

// get a reference to firestore
let db = admin.firestore();

// load the configuration file that contains the Telegram bot token
let config = require('./env.json');
const { query } = require('express');
if (Object.keys(functions.config()).length) {
  config = functions.config();
}

const start_message = `
ברוך הבא עבד צעיר!
הגעת לבוט התורנויות של הקליניקה, הלא היא דירה 2, בן יהודה 48 א׳, תל אביב-יפו
`;

async function handleInform(bot) {
  try {
    let tasksQuerySnapshot = await db.collection('mesimot').get();
    tasksQuerySnapshot.forEach(snapshot => {
      let task = snapshot.data();

      if (task.rotation === undefined) {
        return console.log('this task hadn\'t been started yet!');
      }

      let assigneeId = task.rotation[task.currentIndex];
      bot.telegram.sendMessage(assigneeId, `היום זה התור שלך במשימה ${task.name}, דיר בלאק...`);
      return console.log('sent message to user!');
    });
    return;
  } catch(err) {
    return console.log('failed to perform tasks rotation, ' + err);
  } 
}

async function handleRotation() {
  try {
    let tasksQuerySnapshot = await db.collection('mesimot').get();
    tasksQuerySnapshot.forEach(snapshot => {
       let task = snapshot.data();

       if (task.rotation === undefined) {
         return console.log('task hadn\'t been started yet!');
       }

       if (task.currentIndex === task.rotation.length - 1) {
         task.currentIndex = 0;
       } else {
         task.currentIndex += 1;
       }

      db.collection('mesimot').doc(snapshot.id).set(task);
      return console.log('successfully performed rotation for task: ' + task.name);
    })
  } catch(err) {
    console.log('failed to perform rotation, ' + err);
  }
}

async function handleMesimot(ctx) {
  try {
    let tasks = (await db.collection('mesimot').get()).docs.map(doc => doc.data()).sort((taskA, taskB) => taskA.id > taskB.id);
    let stringReducer = (resultString, currentTask) => resultString + `${currentTask.name} (${currentTask.id.toString()})\n`;
    let tasksListString = tasks.reduce(stringReducer, '');
    let buttonsReducer = (resultArr, currentTask) => resultArr.push(`${currentTask.id}`);
    let buttonTitles = tasks.map((task) => task.name);
    return ctx.reply(tasksListString);
  } catch(err) {
    return console.log('failed to get information of tasks, ' + err);
  }
}

async function handleAni(ctx) {
  try {
    let userSnapshot = await db.collection('users').doc(ctx.from.id.toString()).get();
    if (!userSnapshot.exists) {
      return console.log('couldn\'t a user with the supplied identifier');
    }

    let user = userSnapshot.data();
    let replyString = ''
    if (user.displayName) {
      replyString = 'השם שלך הוא: ' + user.displayName;
    } else {
        replyString = 'השם שלך הוא:  ' + user.firstName;
    }

    return ctx.reply(replyString);
  } catch(err) {
    return console.log('failed to get the user\'s display name, ' + err);
  }
}

async function handleShem(ctx) {
  let messageParts = ctx.message.text.split(' ');
  let nameParts = messageParts.slice(1);

  if (nameParts.length === 0) {
    return console.log('failed to get the user\'s new name');
  }

  try {
    let userId = ctx.from.id.toString();
    let userSnapshot = await db.collection('users').doc(userId).get();
    let user = userSnapshot.data();

    if (!userSnapshot.exists) { return console.log('requested user doesn\'t exists'); }
    let newDisplayName = nameParts.join(' ')
    user.displayName = newDisplayName;
    await db.collection('users').doc(userId).set(user)

    return ctx.reply('השם שלך שונה בהצלחה ל' + newDisplayName);
  } catch(err) {
    return console.log('failed to change the user\'s name, ' + err);
  }
}

async function handleAniEved(ctx) {
  let messageParts = ctx.message.text.split(' ');
  let userId = ctx.from.id.toString();
  let taskId = parseInt(messageParts[1]);

  if (isNaN(taskId)) {
    return console.log('couldn\'t find a task identifier');
  }

  try {
    let tasksQuerySnapshot  = await db.collection('mesimot').where('id', '==', taskId).get();
    if (tasksQuerySnapshot.docs.length === 0) {
      ctx.reply(`לא נמצאה משימה עם המספר המבוקש, שלח /mesimot לקבלת רשימת המשימות`);
      return console.log('couldn\'t find a task with the supplied identifier');
    }
  
    let taskDocRef = tasksQuerySnapshot.docs[0];
    let task = taskDocRef.data();
    task.assignees[userId] = true
    await db.collection('mesimot').doc(taskDocRef.id).set(task);
    return ctx.reply('נרשמת בהצלחה אל ״' + task.name + '״');
  } catch(err) {
    return console.log('failed to register user for the requested task, ' + err);
  }
}

async function handleAvadim(ctx, msgText) {
  let messageParts = msgText.split(' ');
  let taskId = parseInt(messageParts[1]);
  console.log('task identifier is: ' + taskId);

  if (isNaN(taskId)) {
    ctx.reply('יש לצרף מספר משימה, כדי לראות את המשימות הזמינות הקלד /mesimot');
    return console.log("didn't receive a task id");
  }

  try {
    let querySnapshot = await db.collection('mesimot').where('id', '==', taskId).get();

    if (querySnapshot.docs.length === 0) {
      ctx.reply('לא נמצאה משימה עם המספר המבוקש, שלח /mesimot לקבלת רשימת המשימות');
      return console.log('couldn\'t find any task with the received identifier');
    }

    let taskDocSnapshot = querySnapshot.docs[0];
    let task = taskDocSnapshot.data();

    let assigneeIds = Object.keys(task.assignees)
    let assigneesDocSnapshots = (await Promise.all(assigneeIds.map(assigneeId => db.collection('users').doc(assigneeId).get()))).filter(snapshot => snapshot.exists);
    let assignees = assigneesDocSnapshots.map(snapshot => snapshot.data());

    if (assignees.length === 0) {
      ctx.reply(`אף אחד עוד לא נרשם למשימה ״${task.name}״`);
      return conslog.log(`task ${task.name} has no assignees`);
    }

    let assigneesStringReducer = (resultString, assignee) => resultString + `👷🏻‍♂️ ${(assignee.displayName || assignee.firstName)}\n`;
    let assigneesListString = assignees.reduce(assigneesStringReducer, '');

    let replyString = `להלן רשימת העבדים עבור המשימה ״${task.name}״ -\n${assigneesListString}`;
    return ctx.reply(replyString);
  } catch(err) {
    return console.log('failed to get assignees for task, ' + err);
  }
}

async function handleStart(ctx) {
  let userDocRef = db.collection('users').doc(ctx.from.id.toString());

  try {
    await userDocRef.set({
      chatId: ctx.chat.id,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
  } catch(err) {
    console.log('failed to register user in the database, ' + err);
  }

  return ctx.reply(start_message);
}

async function handleYalla(ctx) {
  let messageParts = ctx.message.text.split(' ');
  let taskId = parseInt(messageParts[1]);
  
  if (isNaN(taskId)) {
    ctx.reply('יש להעביר את מספר המשימה, למשימות הזמינות שלח /mesimot');
    return console.log('no task identifier was received')
  }

  try {
    let taskQuerySnapshot = await db.collection('mesimot').where('id', '==', taskId).get();
    if (taskQuerySnapshot.docs.length === 0) {
      ctx.reply(`לא נמצאה משימה עם המספר המבוקש, לרשימת המשימות שלח /mesimot`);
      return consolog.log('couldn\'t find a task with the supplied identifier');
    }

    let taskSnapshot = taskQuerySnapshot.docs[0];
    let task = taskSnapshot.data();

    if (Object.keys(task.assignees).length === 0) {
      ctx.reply('לא ניתן להתחיל משימה שלא נרשמה אליה עבדים!');
      return conslog.log('can\'t start a task without assignees');
    }

    task.rotation = Object.keys(task.assignees);
    task.currentIndex = 0
    task.rotateLastUpdate = new Date();

    await db.collection('mesimot').doc(taskSnapshot.id).set(task);
    return ctx.reply('המשימה אותחלה בהצלחה!')
  } catch(err) {
    return console.log('failed find a task with the supplied identifier, '  + err);
  }
  
}

async function createSikumString(taskDocSnapshot) {
  let task = taskDocSnapshot.data();
  
  if (task.rotation === undefined) return `🔴 המשימה ״${task.name}״ עוד לא אותחלה`;

  let assigneeId = task.rotation[task.currentIndex];
  let assigneeDocSnapshot = await db.collection('users').doc(assigneeId).get();

  if (!assigneeDocSnapshot.exists) return console.log('failed to get assignee data for identifier: ' + assigneeId + `, assignee does not exist!`);

  let assignee = assigneeDocSnapshot.data();
  return `⚪️ העבד של המשימה ״${task.name}״ להיום הוא ${assignee.displayName || assignee.firstName}`;
}

async function handleSikum(ctx) {
  try {
    let resultString = `*להלן סיכום המשימות היומי -*\n`;

    let tasksQuerySnapshot = (await db.collection('mesimot').get()).docs.map(docSnapshot => createSikumString(docSnapshot));
    let tasksSikumStrings = (await Promise.all(tasksQuerySnapshot)).filter(taskSikumString => taskSikumString !== undefined);
    resultString += tasksSikumStrings.join('\n');

    return ctx.reply(resultString, Extra.markup().markdown());
  } catch(err) {
    return console.log('failed to create summary, ' + err);
  }
  
}

const bot = new Telegraf(config.service.telegram_bot_token)

bot.start((ctx) => {
  handleStart(ctx);
})

bot.command('mesimot', (ctx) => {
  handleMesimot(ctx);
});

bot.command('anieved', (ctx) => {
  handleAniEved(ctx);
});

bot.command('shem', async (ctx) => {
  handleShem(ctx);
});

bot.command('avadim', (ctx) => {
  handleAvadim(ctx, ctx.message.text)
});

bot.command('ani', (ctx) => {
  handleAni(ctx);
});

bot.command('yalla', (ctx) => {
  handleYalla(ctx);
});

bot.command('sikum', (ctx) => {
  handleSikum(ctx);
})

// bot.launch();

exports.botHandler = functions.https.onRequest(async (req, res) => {
  await bot.handleUpdate(req.body, res);
  res.send('message handled...');
});

exports.handleInform = functions.https.onRequest(async (req, res) => {
  await handleInform(bot);
  res.send('handling inform...');
});

exports.handleRotation = functions.https.onRequest(async (req, res) => {
  await handleRotation();
  res.send('handling rotation...');
});