//! Spec §9: a crashed engine is restarted after 1 s, 4 s, 16 s; a fourth crash
//! within two minutes means something is wrong that a restart will not fix.

const DELAYS_MS: [u64; 3] = [1_000, 4_000, 16_000];

/// The delay before restart attempt `attempt` (1-based); `None` means give up.
pub fn restart_delay_ms(attempt: u32) -> Option<u64> {
    DELAYS_MS.get(attempt.saturating_sub(1) as usize).copied()
}

/// Crash timestamps within a sliding window; `record` returns how many fall in it, this one included.
pub struct CrashWindow {
    window_ms: u64,
    crashes: Vec<u64>,
}

impl CrashWindow {
    pub fn new(window_ms: u64) -> Self {
        Self {
            window_ms,
            crashes: Vec::new(),
        }
    }
    pub fn record(&mut self, now_ms: u64) -> u32 {
        self.crashes
            .retain(|t| now_ms.saturating_sub(*t) < self.window_ms);
        self.crashes.push(now_ms);
        self.crashes.len() as u32
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delays_are_one_four_sixteen_then_none() {
        assert_eq!(restart_delay_ms(1), Some(1_000));
        assert_eq!(restart_delay_ms(2), Some(4_000));
        assert_eq!(restart_delay_ms(3), Some(16_000));
        assert_eq!(restart_delay_ms(4), None);
        assert_eq!(restart_delay_ms(0), Some(1_000)); // a first crash counts as attempt 1
    }
    #[test]
    fn crashes_count_within_the_window_and_a_quiet_spell_starts_over() {
        let mut w = CrashWindow::new(120_000);
        assert_eq!(w.record(0), 1);
        assert_eq!(w.record(10_000), 2);
        assert_eq!(w.record(50_000), 3);
        assert_eq!(w.record(100_000), 4); // the fourth within two minutes: the caller gives up
        assert_eq!(w.record(300_000), 1); // everything earlier fell out of the window
    }
}
