import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {/* inject, */ BindingScope, injectable, Provider} from '@loopback/core';
import {v4 as uuidv4} from 'uuid';
import {MessageData} from '../types';

export const client = new SQSClient({region: 'us-east-1'});
export const dataQueueUrl =
  'https://sqs.us-east-1.amazonaws.com/341707006720/import-data';

export const ackQueueUrl =
  'https://sqs.us-east-1.amazonaws.com/341707006720/import-ack';

@injectable({scope: BindingScope.TRANSIENT})
export class SendMessageProvider
  implements Provider<(data: MessageData[][]) => Promise<void>>
{
  constructor(/* Add @inject to inject parameters */) {}

  value() {
    return (levelWiseBatches: MessageData[][]) =>
      this.sendMessageLister(levelWiseBatches);
  }

  async sendMessageLister(LevelWiseBatches: MessageData[][]) {
    const fileId = uuidv4();

    let i = 0;
    console.time('importTime');
    while (i < LevelWiseBatches.length) {
      let rows = 0;
      LevelWiseBatches[i].forEach(message => {
        rows += message.rows.length;
      });
      if (LevelWiseBatches[i].length) {
        console.log('sending level ', i);
        this.sendMessage(LevelWiseBatches[i], fileId, rows, i);
        // wait for ACK
        await this.waitForACK(fileId);
        console.log(`level ${i} complete`);
      }
      i++;
    }
  }

  async waitForACK(fileId: string) {
    const params = {
      AttributeNames: ['SentTimestamp'],
      MaxNumberOfMessages: 10,
      MessageAttributeNames: [],
      QueueUrl: ackQueueUrl,
      WaitTimeSeconds: 20,
    };
    const data = await client.send(new ReceiveMessageCommand(params));
    if (data.Messages) {
      for (let i = 0; i < data.Messages.length; i++) {
        const receivedFileId = data.Messages[i].Body;
        if (receivedFileId === fileId) {
          console.log(' received ack ', new Date());
          //delete ack from queue
          const input = {
            QueueUrl: ackQueueUrl,
            ReceiptHandle: data.Messages[i].ReceiptHandle,
          };
          await client.send(new DeleteMessageCommand(input));
          return true;
        }
      }
    }
    await this.waitForACK(fileId);
  }
  sendMessage(
    data: MessageData[],
    fileId: string,
    count: number,
    level: number,
  ) {
    let group = 1;
    // divide messages : max 10 messages can be sent at once in sqs via SendMessageBatchCommand
    for (let i = 0; i < data.length; i += 10) {
      const messageGroup = data.slice(i, i + 10);

      const params: {
        QueueUrl: string;
        Entries: SendMessageBatchRequestEntry[];
      } = {
        QueueUrl: dataQueueUrl,
        Entries: [],
      };

      messageGroup.forEach((message, index) => {
        // MAKE PARAMS CONFIGURABLE
        params.Entries.push({
          MessageAttributes: {
            Title: {
              DataType: 'String',
              StringValue: 'Import from Excel Data',
            },
            Author: {
              DataType: 'String',
              StringValue: 'Barleen',
            },
            FileId: {
              DataType: 'String',
              StringValue: fileId,
            },
            Level: {
              DataType: 'Number',
              StringValue: `${level}`,
            },
            Count: {
              DataType: 'Number',
              StringValue: `${count}`, // count of total number of entries in a level
            },
          },
          MessageBody: JSON.stringify(message),
          Id: `file_${fileId}_level_${level}_group_${group}_message_${
            index + 1
          }`,
        });
      });
      client.send(new SendMessageBatchCommand(params));

      group++;
    }
  }
}
