import { Resend } from 'resend';
import type { Event, User } from '../db/schema';

export class EmailService {
  private resend: Resend;
  private fromEmail: string;

  constructor(apiKey: string, fromEmail: string = 'Fluma <noreply@fluma.events>') {
    this.resend = new Resend(apiKey);
    this.fromEmail = fromEmail;
  }

  async sendEventUpdateNotification(
    event: Event,
    attendees: User[],
    changes: string[]
  ): Promise<void> {
    if (attendees.length === 0) return;

    const changesList = changes.map(c => `• ${c}`).join('\n');
    
    const emails = attendees.map(attendee => ({
      from: this.fromEmail,
      to: attendee.email,
      subject: `Event Updated: ${event.title}`,
      html: `
        <h2>Event Update</h2>
        <p>Hi ${attendee.first_name},</p>
        <p>The event "<strong>${event.title}</strong>" has been updated.</p>
        
        <h3>Changes:</h3>
        <ul>
          ${changes.map(c => `<li>${c}</li>`).join('')}
        </ul>
        
        <h3>Updated Event Details:</h3>
        <ul>
          <li><strong>Title:</strong> ${event.title}</li>
          <li><strong>Date:</strong> ${new Date(event.date).toLocaleString()}</li>
          <li><strong>Location:</strong> ${event.location}</li>
          ${event.description ? `<li><strong>Description:</strong> ${event.description}</li>` : ''}
        </ul>
        
        <p>See you there!</p>
        <p>— The Fluma Team</p>
      `,
      text: `
Event Update

Hi ${attendee.first_name},

The event "${event.title}" has been updated.

Changes:
${changesList}

Updated Event Details:
- Title: ${event.title}
- Date: ${new Date(event.date).toLocaleString()}
- Location: ${event.location}
${event.description ? `- Description: ${event.description}` : ''}

See you there!
— The Fluma Team
      `.trim(),
    }));

    // Send emails in batches (Resend supports batch sending)
    try {
      await this.resend.batch.send(emails);
    } catch (error) {
      console.error('Failed to send event update emails:', error);
      // Don't throw - email failures shouldn't break the main flow
    }
  }

  async sendEventCancellationNotification(
    event: Event,
    attendees: User[]
  ): Promise<void> {
    if (attendees.length === 0) return;

    const emails = attendees.map(attendee => ({
      from: this.fromEmail,
      to: attendee.email,
      subject: `Event Cancelled: ${event.title}`,
      html: `
        <h2>Event Cancelled</h2>
        <p>Hi ${attendee.first_name},</p>
        <p>We're sorry to inform you that the event "<strong>${event.title}</strong>" scheduled for ${new Date(event.date).toLocaleString()} has been cancelled.</p>
        <p>We apologize for any inconvenience.</p>
        <p>— The Fluma Team</p>
      `,
      text: `
Event Cancelled

Hi ${attendee.first_name},

We're sorry to inform you that the event "${event.title}" scheduled for ${new Date(event.date).toLocaleString()} has been cancelled.

We apologize for any inconvenience.

— The Fluma Team
      `.trim(),
    }));

    try {
      await this.resend.batch.send(emails);
    } catch (error) {
      console.error('Failed to send event cancellation emails:', error);
    }
  }

  async sendRSVPConfirmation(
    event: Event,
    user: User,
    status: string
  ): Promise<void> {
    const statusText = status === 'going' ? "You're going!" : 
                       status === 'maybe' ? "You might attend" : 
                       "You can't make it";

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: user.email,
        subject: `RSVP Confirmed: ${event.title}`,
        html: `
          <h2>${statusText}</h2>
          <p>Hi ${user.first_name},</p>
          <p>Your RSVP for "<strong>${event.title}</strong>" has been recorded.</p>
          
          <h3>Event Details:</h3>
          <ul>
            <li><strong>Date:</strong> ${new Date(event.date).toLocaleString()}</li>
            <li><strong>Location:</strong> ${event.location}</li>
            ${event.description ? `<li><strong>Description:</strong> ${event.description}</li>` : ''}
          </ul>
          
          <p>You can update your RSVP at any time.</p>
          <p>— The Fluma Team</p>
        `,
        text: `
${statusText}

Hi ${user.first_name},

Your RSVP for "${event.title}" has been recorded.

Event Details:
- Date: ${new Date(event.date).toLocaleString()}
- Location: ${event.location}
${event.description ? `- Description: ${event.description}` : ''}

You can update your RSVP at any time.

— The Fluma Team
        `.trim(),
      });
    } catch (error) {
      console.error('Failed to send RSVP confirmation email:', error);
    }
  }
}
