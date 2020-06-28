const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Telegraf = require('telegraf')
const Extra = require('telegraf/extra');
const Markup = require('telegraf/markup');

// authenticate so we can access services
admin.initializeApp();

// get a reference to firestore
let db = admin.firestore();

// load the configuration file that contains the Telegram bot token
let config = require('./env.json');
if (Object.keys(functions.config()).length) config = functions.config();

const start_message = `ברוך הבא עבד צעיר!\nהגעת לבוט התורנויות של הקליניקה, הלא היא דירה 2, בן יהודה 48 א׳, תל אביב-יפו`;

async function handleStart(ctx) {
  let senderId = ctx.from.id.toString();
  let userDocRef = db.collection('users').doc(senderId);

  try {
    await userDocRef.set({
      chatId: ctx.chat.id,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
  } catch (err) {
    return console.log('failed to register user in the database, ' + err);
  }

  ctx.reply(start_message);
  return undefined;
}

async function handleMesimot(ctx) {
  let tasksRef = db.collection('mesimot')

  let tasksSnapshot;
  try {
    tasksSnapshot = await tasksRef.get();
  } catch (err) {
    return console.log('failed to get tasks from database, ' + err);
  }

  let tasks = tasksSnapshot.docs.map(docSnapshot => docSnapshot.data());
  let sortedTasks = tasks.sort((taskA, taskB) => taskA.id > taskB.id);
  let taskDescriptionArr = sortedTasks.map(task => `(${task.id}) ${task.name}`);
  let replyMsgStr = taskDescriptionArr.join('\n');

  ctx.reply(replyMsgStr);
  return undefined;
}

async function handleAni(ctx) {
  let senderId = ctx.from.id.toString();
  let userRef = db.collection('users').doc(senderId);

  let userSnapshot;
  try {
    userSnapshot = await userRef.get();
  } catch (err) {
    return console.log(`failed to get user with identifier ${ctx.from.id} from database`);
  }

  if (!userSnapshot.exists) return console.log('failed to find a user with the supplied identifier');
  let user = userSnapshot.data();
  let userName = user.displayName || user.firstName;
  let replyMsgStr = `שם התצוגה שלך הוא *${userName}*`;

  ctx.reply(replyMsgStr, Extra.markup().markdown());
  return undefined;
}

async function handleShem(ctx) {
  let messageParts = ctx.message.text.split(' ');
  let nameParts = messageParts.slice(1);

  if (nameParts.length === 0) {
    ctx.reply('כדי לשנות שם יש להוסיף את השם החדש לאחר הפקודה /shem');
    return console.log('failed to get the user\'s new name');
  }

  let newName = nameParts.join(' ');
  let senderId = ctx.from.id.toString();
  let userRef = db.collection('users').doc(senderId);

  let userSnapshot;
  try {
    userSnapshot = await userRef.get();
  } catch (err) {
    return console.log('failed to update the user\'s name, ' + err);
  }

  if (!userSnapshot.exists) return console.log(`failed to find user with identifier ${senderId}`);
  let user = userSnapshot.data();
  user.displayName = newName;

  try {
    await userRef.set(user);
  } catch (err) {
    return console.log(`failed to update the user's name, ${err}`);
  }

  ctx.reply(`השם שלך שונה בהצלחה ל-*${newName}*`, Extra.markup().markdown());
  return undefined;
}

async function handleAvadim(ctx) {
  let msgText = ctx.message.text;
  let msgParts = msgText.split(' ');
  let taskId = parseInt(msgParts[1]);

  if (taskId === undefined || isNaN(taskId)) {
    ctx.reply('יש לצרף מספר משימה, כדי לראות את המשימות הזמינות הקלד /mesimot');
    return console.log('failed to get the tasks identifier');
  }

  let taskQuery = db.collection('mesimot').where('id', '==', taskId);

  let taskQuerySnapshot;
  try {
    taskQuerySnapshot = await taskQuery.get();
  } catch (err) {
    return console.log(`failed to get task with identifier ${taskId} from database ${err}`);
  }

  if (taskQuerySnapshot.docs.length === 0) {
    ctx.reply('לא נמצאה משימה עם המספר שנשלח, כדי לראות את המשימות הזמינות הקלד /mesimot');
    return console.log(`failed to find a task with identifier ${taskId}`);
  }

  let taskDocSnapshot = taskQuerySnapshot.docs[0];
  let task = taskDocSnapshot.data();

  let assigneeIds = Object.keys(task.assignees);
  let assigneeRefs = assigneeIds.map(assigneeId => db.collection('users').doc(assigneeId));

  let assigneeDocSnapshots;
  try {
    assigneeDocSnapshots = await Promise.all(assigneeRefs.map(ref => ref.get()));
  } catch (err) {
    return console.log(`failed to get assignees from database, ${err}`);
  }

  assigneeDocSnapshots = assigneeDocSnapshots.filter(docSnapshot => docSnapshot.exists);
  let assignees = assigneeDocSnapshots.map(docSnapshot => docSnapshot.data());
  let assigneeDescArr = assignees.map(assignee => `👷🏻‍♂️ ${assignee.displayName || assignee.firstName}`);
  let replyMsgStr = assigneeDescArr.join('\n');

  ctx.reply(replyMsgStr);
  return undefined;
}

const bot = new Telegraf(config.service.telegram_bot_token);

bot.start(async (ctx) => await handleStart(ctx));
bot.command('mesimot', async (ctx) => await handleMesimot(ctx));
bot.command('ani', async (ctx) => await handleAni(ctx));
bot.command('shem', async (ctx) => await handleShem(ctx));
bot.command('avadim', async (ctx) => await handleAvadim(ctx));

exports.botHandler = functions.https.onRequest(async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res)
    if (!res.writableEnded) {
      res.end();
    }
  } catch (err) {
    res.status(500).send('something went wrong');
  }
});