# Host wire numbers remain strings

Host Message Service represents numeric-looking wire fields as strings, binary values as byte arrays, and bounded repeating data as arrays of field sets. It rejects JavaScript numbers and arbitrary objects because codecs must preserve leading zeroes, arbitrary precision, exact byte intent, and a safely traversable value shape; bank-owned mappers perform later business-type conversion.
