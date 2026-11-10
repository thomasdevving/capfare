use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::near;
use near_sdk::serde::{de, Deserialize, Deserializer, Serialize, Serializer};

/// Unix timestamp in seconds.
pub type Timestamp = u64;
/// EUR cents.
pub type Cents = u64;

macro_rules! hex_bytes {
    ($name:ident, $n:expr) => {
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, BorshSerialize, BorshDeserialize)]
        #[borsh(crate = "near_sdk::borsh")]
        pub struct $name(pub [u8; $n]);

        impl $name {
            pub fn to_hex(&self) -> String {
                hex::encode(self.0)
            }
            pub fn from_hex(s: &str) -> Result<Self, String> {
                let s = s.strip_prefix("0x").unwrap_or(s);
                let v = hex::decode(s).map_err(|e| e.to_string())?;
                let arr: [u8; $n] = v
                    .try_into()
                    .map_err(|_| format!("expected {} bytes", $n))?;
                Ok(Self(arr))
            }
        }
        impl core::fmt::Debug for $name {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                write!(f, "{}", self.to_hex())
            }
        }
        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(&self.to_hex())
            }
        }
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let s = <String as Deserialize>::deserialize(d)?;
                Self::from_hex(&s).map_err(de::Error::custom)
            }
        }
    };
}

hex_bytes!(Hash32, 32);
hex_bytes!(Sig64, 64);

/// One exact flight: the unit of coverage.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FlightKey {
    /// IATA airline code, e.g. "KL".
    pub airline: String,
    /// e.g. "KL1695" (airline prefix + digits, no spaces).
    pub flight_number: String,
    /// Local date at origin, "YYYY-MM-DD".
    pub departure_date: String,
    /// IATA airport code.
    pub origin: String,
    /// IATA airport code.
    pub destination: String,
    /// Normalised fare class, e.g. "economy_light".
    pub fare_class: String,
}

/// Most travellers one policy can cover (one booking, same flight, same fare).
pub const MAX_SEATS: u8 = 9;

pub const FARE_CLASSES: &[&str] = &[
    "economy_light",
    "economy_standard",
    "economy_flex",
    "premium_economy",
    "business",
];

fn is_upper_alnum(s: &str) -> bool {
    s.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

impl FlightKey {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.airline.len() != 2 || !is_upper_alnum(&self.airline) {
            return Err("airline must be a 2-character uppercase IATA code");
        }
        if !self.flight_number.starts_with(&self.airline)
            || self.flight_number.len() < 3
            || self.flight_number.len() > 7
            || !self.flight_number[2..].chars().all(|c| c.is_ascii_digit())
        {
            return Err("flight_number must be the airline code followed by 1-5 digits");
        }
        validate_date(&self.departure_date)?;
        validate_airports(&self.origin, &self.destination)?;
        if !FARE_CLASSES.contains(&self.fare_class.as_str()) {
            return Err("unknown fare_class");
        }
        Ok(())
    }
}

fn validate_date(d: &str) -> Result<(), &'static str> {
    let d = d.as_bytes();
    let ok = d.len() == 10
        && d[4] == b'-'
        && d[7] == b'-'
        && d.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if ok {
        Ok(())
    } else {
        Err("departure_date must be YYYY-MM-DD")
    }
}

fn validate_airports(origin: &str, destination: &str) -> Result<(), &'static str> {
    for a in [origin, destination] {
        if a.len() != 3 || !a.chars().all(|c| c.is_ascii_uppercase()) {
            return Err("airports must be 3-letter uppercase IATA codes");
        }
    }
    if origin == destination {
        return Err("origin and destination must differ");
    }
    Ok(())
}

/// Airport groups for flexible route cover: a code starting with '@' stands for every airport
/// in the group (e.g. all London airports). Mirrored in /shared/src/encoding.ts.
pub const AIRPORT_GROUPS: &[(&str, &[&str])] = &[
    ("@LON", &["LHR", "LGW", "STN", "LTN", "LCY", "SEN"]),
    ("@PAR", &["CDG", "ORY", "BVA"]),
    ("@NL", &["AMS", "RTM", "EIN"]),
    ("@MIL", &["MXP", "LIN", "BGY"]),
    ("@ROM", &["FCO", "CIA"]),
    ("@NYC", &["JFK", "EWR", "LGA"]),
];

/// Widest date window for flexible cover: the chosen day plus or minus this many days.
pub const MAX_DATE_WINDOW_DAYS: u8 = 3;

/// The airports an origin or destination code stands for: a group's members, or the airport.
pub fn airports_of(code: &str) -> Vec<&str> {
    match AIRPORT_GROUPS.iter().find(|(g, _)| *g == code) {
        Some((_, members)) => members.to_vec(),
        None => vec![code],
    }
}

pub fn is_airport_group(code: &str) -> bool {
    AIRPORT_GROUPS.iter().any(|(g, _)| *g == code)
}

/// Days since 1970-01-01 for a valid "YYYY-MM-DD" (proleptic Gregorian).
pub fn days_from_date(d: &str) -> Option<i64> {
    let y: i64 = d.get(0..4)?.parse().ok()?;
    let m: i64 = d.get(5..7)?.parse().ok()?;
    let day: i64 = d.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// Flexible coverage: every non-stop flight CapFare's price oracle tracks between the origin
/// and destination (an airport or an airport group) on the departure day, or within
/// `date_window_days` either side of it, in one fare class. The index is the cheapest available
/// fare among them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteKey {
    /// IATA airport code, or an airport group code such as "@LON".
    pub origin: String,
    pub destination: String,
    /// Local date at origin, "YYYY-MM-DD" (the middle of the window).
    pub departure_date: String,
    /// 0..=MAX_DATE_WINDOW_DAYS: also covers flights this many days before and after.
    #[serde(default)]
    pub date_window_days: u8,
    pub fare_class: String,
}

impl RouteKey {
    pub fn validate(&self) -> Result<(), &'static str> {
        validate_date(&self.departure_date)?;
        if days_from_date(&self.departure_date).is_none() {
            return Err("departure_date must be YYYY-MM-DD");
        }
        for a in [&self.origin, &self.destination] {
            let airport = a.len() == 3 && a.chars().all(|c| c.is_ascii_uppercase());
            if !airport && !is_airport_group(a) {
                return Err("airports must be 3-letter uppercase IATA codes or airport groups such as @LON");
            }
        }
        let (o, d) = (airports_of(&self.origin), airports_of(&self.destination));
        if o.iter().any(|a| d.contains(a)) {
            return Err("origin and destination must differ");
        }
        if self.date_window_days > MAX_DATE_WINDOW_DAYS {
            return Err("date window must be 0 to 3 days");
        }
        if !FARE_CLASSES.contains(&self.fare_class.as_str()) {
            return Err("unknown fare_class");
        }
        Ok(())
    }

    /// Flexible beyond one route and day: a date window or an airport group.
    pub fn uses_group(&self) -> bool {
        is_airport_group(&self.origin) || is_airport_group(&self.destination)
    }

    /// True if `k` is a flight this route coverage pays for.
    pub fn matches(&self, k: &FlightKey) -> bool {
        let day = |d: &str| days_from_date(d);
        let in_window = match (day(&k.departure_date), day(&self.departure_date)) {
            (Some(a), Some(b)) => (a - b).abs() <= i64::from(self.date_window_days),
            _ => false,
        };
        airports_of(&self.origin).contains(&k.origin.as_str())
            && airports_of(&self.destination).contains(&k.destination.as_str())
            && in_window
            && k.fare_class == self.fare_class
    }
}

/// What a policy covers: one exact flight, or any tracked flight on a route and day.
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Coverage {
    Flight(FlightKey),
    Route(RouteKey),
}

impl Coverage {
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            Coverage::Flight(k) => k.validate(),
            Coverage::Route(r) => r.validate(),
        }
    }
    pub fn origin(&self) -> &str {
        match self {
            Coverage::Flight(k) => &k.origin,
            Coverage::Route(r) => &r.origin,
        }
    }
    pub fn destination(&self) -> &str {
        match self {
            Coverage::Flight(k) => &k.destination,
            Coverage::Route(r) => &r.destination,
        }
    }
    pub fn fare_class(&self) -> &str {
        match self {
            Coverage::Flight(k) => &k.fare_class,
            Coverage::Route(r) => &r.fare_class,
        }
    }
    /// True if a booking for flight `k` can be used with this coverage.
    pub fn covers(&self, k: &FlightKey) -> bool {
        match self {
            Coverage::Flight(f) => f == k,
            Coverage::Route(r) => r.matches(k),
        }
    }
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Product {
    Cap,
    Drop,
}

impl Product {
    pub fn as_str(&self) -> &'static str {
        match self {
            Product::Cap => "cap",
            Product::Drop => "drop",
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Signals {
    /// 0..=4, price change over the last 24–72h (2 = flat).
    pub momentum_bucket: u8,
    /// 0..=4, fare-class closures / seat signals (0 = plenty of seats).
    pub availability_bucket: u8,
    pub season_flag: bool,
}

impl Signals {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.momentum_bucket > 4 || self.availability_bucket > 4 {
            return Err("signal buckets must be 0..=4");
        }
        Ok(())
    }
}

/// Oracle snapshot as signed by the price_oracle enclave.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PriceSnapshot {
    pub flight_key_hash: Hash32,
    pub price_minor: Cents,
    pub currency: String,
    pub available: bool,
    pub signals: Signals,
    /// Scheduled departure (UTC seconds). Added vs. the brief: the chain needs
    /// an absolute time for days-to-departure and the final status check.
    pub departure_ts: Timestamp,
    pub observed_at: Timestamp,
    pub source_id: String,
    pub enclave_measurement: Hash32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignedSnapshot {
    pub snapshot: PriceSnapshot,
    /// ed25519 public key of the enclave that signed it.
    pub signer: Hash32,
    pub signature: Sig64,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BookingStatus {
    Active,
    Cancelled,
    Unknown,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refundability {
    NonRefundable,
    Refundable,
    Unknown,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerificationMethod {
    /// Original confirmation email, DKIM-verified in the enclave.
    DkimEml,
    /// Enclave logged into the manage-booking page with booking code + last name.
    StatusCheck,
    /// User-initiated: the enclave fetched the user's own manage-booking page over TLS
    /// (link from the extension or pasted by the user). Shows the booking as it is now.
    TlsPage,
}

impl VerificationMethod {
    /// Live methods read the booking's current state from the booking site itself.
    pub fn is_live(&self) -> bool {
        !matches!(self, VerificationMethod::DkimEml)
    }
}

/// Booking attestation as signed by the booking_verifier enclave. Contains no PII.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BookingAttestation {
    pub flight_key_hash: Hash32,
    pub paid_price_minor: Cents,
    pub currency: String,
    pub fare_class: String,
    pub refundable: Refundability,
    /// H(enclave_salt || airline || booking_ref)
    pub booking_ref_nullifier: Hash32,
    pub status: BookingStatus,
    pub method: VerificationMethod,
    /// When the booking was made (from the DKIM-signed mail Date header or the
    /// airline's booking page). Added vs. the brief: needed for the cap window.
    pub booked_at: Timestamp,
    pub verified_at: Timestamp,
    pub enclave_measurement: Hash32,
    /// sha256("capfare/passenger/v1" || borsh(normalised last name) || salt), computed in
    /// the enclave from the booking's lead passenger and a salt only the user knows. Binds
    /// a booking to the policy holder without putting the name on-chain.
    pub passenger_commitment: Hash32,
    /// Travellers on the booking (1..=MAX_SEATS). `paid_price_minor` is per traveller.
    pub seats: u8,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignedBookingAttestation {
    pub attestation: BookingAttestation,
    pub signer: Hash32,
    pub signature: Sig64,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ServiceKind {
    PriceOracle,
    BookingVerifier,
}
