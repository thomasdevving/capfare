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

/// Flexible coverage: every non-stop flight CapFare's price oracle tracks on one route and
/// departure day, in one fare class. The index is the cheapest available fare among them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteKey {
    pub origin: String,
    pub destination: String,
    /// Local date at origin, "YYYY-MM-DD".
    pub departure_date: String,
    pub fare_class: String,
}

impl RouteKey {
    pub fn validate(&self) -> Result<(), &'static str> {
        validate_date(&self.departure_date)?;
        validate_airports(&self.origin, &self.destination)?;
        if !FARE_CLASSES.contains(&self.fare_class.as_str()) {
            return Err("unknown fare_class");
        }
        Ok(())
    }

    /// True if `k` is a flight this route coverage pays for.
    pub fn matches(&self, k: &FlightKey) -> bool {
        k.origin == self.origin
            && k.destination == self.destination
            && k.departure_date == self.departure_date
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
