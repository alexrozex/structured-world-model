# Cron Jobs: Complete Knowledge Base

## Quick Reference

### Syntax

```
MIN HOUR DOM MON DOW command
 |    |    |   |   |
 |    |    |   |   +-- Day of week (0-6, Sun=0)
 |    |    |   +------ Month (1-12)
 |    |    +---------- Day of month (1-31)
 |    +--------------- Hour (0-23)
 +-------------------- Minute (0-59)
```

### Operators

- `*` — wildcard (all values)
- `,` — list (1,3,5)
- `-` — range (1-5)
- `/` — step (\*/5 = every 5)

### Common Patterns

```bash
*/5 * * * *      # Every 5 minutes
0 * * * *        # Every hour
0 2 * * *        # Daily at 2 AM
0 9-17 * * 1-5   # Hourly 9-5 weekdays
0 0 1 * *        # Monthly (1st at midnight)
```

---

## Management Commands

```bash
crontab -e           # Edit current user's crontab
crontab -l           # List current cron jobs
crontab -r           # Remove all cron jobs
sudo crontab -u USER -e  # Edit another user's crontab
```

## Environment Variables (set at top of crontab)

```bash
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
HOME=/Users/username
MAILTO="user@example.com"
CRON_TZ="America/Vancouver"
```

**Critical:** Cron runs with minimal environment. It does NOT load `~/.bashrc`, `~/.zshrc`, or `~/.profile`. Always:

- Use absolute paths for all commands
- Set PATH explicitly in crontab
- Or source profile in the script itself

## Debugging

```bash
# Dump cron's actual environment
* * * * * env > /tmp/cron-env.txt

# Check cron service status
systemctl status cron        # Linux
launchctl list | grep cron   # macOS

# View cron logs
grep CRON /var/log/syslog    # Debian/Ubuntu
cat /var/log/cron            # RHEL/CentOS
log show --predicate 'process == "cron"' --last 1h  # macOS
```

## Output Redirection

```bash
# Both stdout and stderr to log
0 2 * * * /path/script.sh >> /var/log/job.log 2>&1

# Separate success and error logs
0 2 * * * /path/script.sh >> /var/log/job.log 2>> /var/log/job-error.log

# Suppress all output
0 2 * * * /path/script.sh > /dev/null 2>&1

# Timestamped logging (in script)
echo "$(date '+%Y-%m-%d %H:%M:%S') Message" >> /var/log/job.log
```

## Preventing Overlap (flock)

```bash
# In crontab — skip if previous run still active
*/5 * * * * /usr/bin/flock -w 0 /var/lock/myjob.lock /path/myjob.sh

# In script — mkdir-based lock (no external tool)
mkdir /var/lock/myjob.lock 2>/dev/null || exit 1
trap "rmdir /var/lock/myjob.lock" EXIT
```

## Idempotent Design

- Check state before acting (don't blindly overwrite)
- Use checkpoints to track progress
- Run at 2x frequency for automatic retry: if daily job fails at 2 AM, the 2 PM run catches it
- Monitor for "hasn't succeeded in X hours" not "failed once"

## Security Hardening

- Never run as root unless required — use dedicated service users
- Scripts: `chmod 700` (owner only)
- Use `/etc/cron.allow` to whitelist users (overrides `/etc/cron.deny`)
- No hardcoded credentials — use env vars or secure credential files (mode 600)
- Use absolute paths everywhere (prevents PATH hijacking)
- Validate/sanitize all external input in scripts

## Claude Code Integration

### Non-interactive execution

```bash
claude --dangerously-skip-permissions -p "prompt here" --output-file report.txt
```

### Safer: allowlisted tools in .claude/settings.json

```json
{
  "permissions": {
    "allow": ["Read", "Glob", "Grep", "WebSearch", "WebFetch"]
  }
}
```

### Scheduled triggers (native)

Claude Code supports `schedule` skill for cron-based triggers — runs remote agents on schedule without local crontab.

### Hooks for monitoring

14 hook event types available — use for Slack notifications on failure, log processing after completion, etc.

## Production Checklist

### Pre-deploy

- [ ] Script tested manually with expected inputs + edge cases
- [ ] Tested in cron-like environment (minimal PATH, no profile)
- [ ] Cron expression validated (crontab.guru)
- [ ] Security review: least privilege, no hardcoded creds
- [ ] Documented: purpose, dependencies, expected behavior

### Configuration

- [ ] Absolute paths for all commands and files
- [ ] Environment variables set in crontab header
- [ ] MAILTO configured for alerts
- [ ] flock/lockfile for overlap prevention
- [ ] Error handling + meaningful exit codes

### Monitoring

- [ ] Output redirected to timestamped log files
- [ ] Log rotation configured (logrotate)
- [ ] Failure alerts (email, Slack, monitoring service)
- [ ] Health checks / heartbeat pings
- [ ] Runbooks for common failure scenarios

## Cron vs Systemd Timers

| Feature      | Cron            | Systemd Timers                |
| ------------ | --------------- | ----------------------------- |
| Simplicity   | Simple syntax   | More complex (unit files)     |
| Portability  | All Unix/macOS  | Linux only                    |
| Logging      | Manual redirect | Built-in (journald)           |
| Missed jobs  | Lost            | Persistent=true catches up    |
| Dependencies | None            | Full systemd dependency chain |
| Status check | `crontab -l`    | `systemctl status job.timer`  |

**Use cron** for simple, portable tasks. **Use systemd timers** for production-critical tasks needing reliability, dependency management, and logging.
