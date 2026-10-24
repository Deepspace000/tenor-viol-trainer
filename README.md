# Tenor Viol Clef Trainer

A web page for learning to read the C clef (alto clef) on the tenor viol da gamba.

Open it here: https://deepspace000.github.io/tenor-viol-trainer/

- The viol neck with every note named. Tap a note to hear it and see it on the staff.
- Quizzes: find a staff note on the neck, name a note on the neck, name a note on the staff.
- Any key signature, and alto, tenor, octave treble, treble or bass clef.
- A score you write by tapping the neck: breve, semibreve, minim, crotchet, quaver and semiquaver, with dots, rests, ties across bar lines, any time signature and tempo. Play it back, save it as .json and load it again, or save it as a PDF.
- Record from a microphone: the notes you play on the viol are written into the score.
- Import MIDI, MusicXML, or printed music as a PDF or picture. Printed music is read on the page itself: notes, rests, rhythms, dots, ties, bar lines, key and time signature and accidentals.

Keys: left and right arrows move from note to note in the score, up and down change the rhythm, 1 to 6 pick a rhythm, `.` adds a dot, R adds a rest, Backspace deletes.

Tenor viol tuning: G2 C3 F3 A3 D4 G4 (a fourth above the bass viol).

Uses [VexFlow](https://github.com/0xfe/vexflow) (MIT) for the staves and [PDF.js](https://github.com/mozilla/pdf.js) (Apache 2.0) to open PDFs.
