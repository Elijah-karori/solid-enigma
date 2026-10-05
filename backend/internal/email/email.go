package email

import (
	"bytes"
	"fmt"
	"net/smtp"
	"strings"
	"log"
)

// Sender defines the interface for dispatching emails
type Sender interface {
	SendEmail(to []string, subject, body string, isHTML bool) error
}

type SMTPSender struct {
	host     string
	port     int
	username string
	password string
	from     string
}

func NewSMTPSender(host string, port int, username, password, from string) *SMTPSender {
	return &SMTPSender{
		host:     host,
		port:     port,
		username: username,
		password: password,
		from:     from,
	}
}

func (s *SMTPSender) SendEmail(to []string, subject, body string, isHTML bool) error {
	auth := smtp.PlainAuth("", s.username, s.password, s.host)

	var msg bytes.Buffer
	msg.WriteString(fmt.Sprintf("From: %s\r\n", s.from))
	msg.WriteString(fmt.Sprintf("To: %s\r\n", strings.Join(to, ",")))
	msg.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	msg.WriteString("MIME-version: 1.0;\n")
	if isHTML {
		msg.WriteString("Content-Type: text/html; charset=\"UTF-8\";\n\n")
	} else {
		msg.WriteString("Content-Type: text/plain; charset=\"UTF-8\";\n\n")
	}
	msg.WriteString(body)

	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	err := smtp.SendMail(addr, auth, s.from, to, msg.Bytes())
	if err != nil {
		fmt.Printf("SMTP Send Error: %v\n", err)
		return fmt.Errorf("failed to send email: %w", err)
	}
	fmt.Printf("Email sent successfully to %v\n", to)
	return nil
}

type LogSender struct{}

func (s *LogSender) SendEmail(to []string, subject, body string, isHTML bool) error {
	log.Printf("\n--- [EMAIL LOG] ---\nTo: %s\nSubject: %s\nHTML: %v\nBody:\n%s\n-------------------\n", 
		strings.Join(to, ", "), subject, isHTML, body)
	return nil
}

func NewLogSender() *LogSender {
	return &LogSender{}
}
